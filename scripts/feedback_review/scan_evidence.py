"""Bounded private report retrieval and isolated ephemeral previews."""
import base64
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import signal
import subprocess
import time
import urllib.error
import urllib.request
import uuid

ORIGIN='https://staging.pastetospeech.com'
MAX_BYTES=50_000_000
MAX_PREVIEWS=3
POLICY='private-scan-review-7-days-v1'
USER_AGENT='PasteToSpeechFeedbackReviewer/1.0'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

@contextmanager
def deadline(seconds):
    previous=signal.getsignal(signal.SIGALRM)
    def expired(*_):raise TimeoutError('scan_retrieval_timeout')
    signal.signal(signal.SIGALRM,expired)
    old=signal.setitimer(signal.ITIMER_REAL,seconds)
    try:yield
    finally:
        signal.setitimer(signal.ITIMER_REAL,*old)
        signal.signal(signal.SIGALRM,previous)

def access_token():
    # Existing app-specific CLI cache only. No auto login, browser or new credentials.
    config=json.loads((Path(__file__).resolve().parents[2]/'cloudflare/reader/wrangler.staging.jsonc').read_text())['vars']
    path=Path.home()/'.cloudflared'/f"staging.pastetospeech.com-{config['ACCESS_AUD']}-token"
    try:
        value=path.read_text().strip()
        if len(value)>16000:return None
        part=value.split('.')[1]
        claims=json.loads(base64.urlsafe_b64decode(part+'='*(-len(part)%4)))
        if (claims.get('exp',0)<=time.time()+10 or config['ACCESS_AUD'] not in claims.get('aud',[])
                or claims.get('iss')!=config['ACCESS_ISSUER'] or claims.get('email')!=config['OWNER_EMAIL']):return None
        return value
    except (OSError,ValueError,IndexError,TypeError):return None

def retrieve(report,fetcher=None,token_reader=access_token,clock=time.time):
    scan=report.get('context',{}).get('scanReport')
    if not scan:return None,{'state':'not_requested','previews':0}
    attachment=scan.get('attachment')
    if not attachment:return None,{'state':'metadata_only','previews':0,'reason':scan.get('attachmentUnavailableReason')}
    identity=str(uuid.UUID(report['id']))
    if (os.environ.get('P2S_FEEDBACK_ENVIRONMENT')!='staging' or identity!=scan.get('reportId')
            or scan.get('inspectionConsent') is not True or attachment.get('storage')!='original_reference'
            or attachment.get('consentPolicy')!=POLICY):raise ValueError('invalid_scan_reference')
    expires=attachment.get('expires')
    if type(expires) is not int:raise ValueError('invalid_scan_reference')
    if expires<=clock()*1000:return None,{'state':'expired','previews':0}
    size,mime,sha=attachment.get('bytes'),attachment.get('mime'),attachment.get('sha256')
    if (type(size) is not int or not 0<size<=MAX_BYTES or mime not in {'image/png','image/jpeg','image/webp','application/pdf'}
            or sha is not None and not re.fullmatch('[a-f0-9]{64}',sha)):raise ValueError('invalid_scan_reference')
    token=token_reader()
    if not token:return None,{'state':'access_expired','previews':0}
    request=urllib.request.Request(ORIGIN+'/api/scan-feedback/'+identity+'/attachment',
        headers={'Cookie':'CF_Authorization='+token,'Sec-Fetch-Site':'same-origin','User-Agent':USER_AGENT,'Accept':mime})
    fetcher=fetcher or urllib.request.build_opener(NoRedirect()).open
    try:
        with deadline(30),fetcher(request,timeout=30) as response:
            if response.headers.get_content_type()!=mime or response.headers.get('Content-Length')!=str(size):
                raise ValueError('scan_response_mismatch')
            data=response.read(size+1)
            if len(data)!=size or sha is not None and hashlib.sha256(data).hexdigest()!=sha:
                raise ValueError('scan_response_mismatch')
    except urllib.error.HTTPError as error:
        return None,{'state':'unavailable' if error.code in {404,410} else 'access_denied' if error.code==403 else 'retrieval_failed','previews':0}
    except Exception:return None,{'state':'retrieval_failed','previews':0}
    return data,{'state':'retrieved','mime':mime,'originalBytes':size,'expires':expires,'previews':0}

def render_limits():
    resource.setrlimit(resource.RLIMIT_AS,(512*1024*1024,512*1024*1024))
    resource.setrlimit(resource.RLIMIT_CPU,(20,20))
    resource.setrlimit(resource.RLIMIT_FSIZE,(10*1024*1024,10*1024*1024))
    resource.setrlimit(resource.RLIMIT_NOFILE,(32,32))

def preview_namespace(folder):
    # Untrusted image/PDF parsers receive no network, home, auth, repository or sockets.
    args=['/usr/bin/bwrap','--die-with-parent','--new-session','--unshare-all','--cap-drop','ALL','--clearenv',
        '--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--symlink','usr/lib','/lib','--symlink','usr/lib64','/lib64',
        '--dev','/dev','--proc','/proc','--tmpfs','/tmp','--dir','/etc','--dir','/work',
        '--bind',str(folder),'/work','--setenv','PATH','/usr/bin:/bin','--setenv','LANG','C.UTF-8','--chdir','/work']
    if Path('/etc/fonts').exists():args+=['--ro-bind','/etc/fonts','/etc/fonts']
    return args

def previews(data,evidence,temporary):
    if data is None:return [],evidence
    expires=evidence.get('expires')
    if expires is not None and expires<=time.time()*1000:return [],{**evidence,'state':'expired','previews':0}
    folder=temporary/'scan-preview';folder.mkdir(mode=0o700)
    source=folder/'input-scan.bin';source.write_bytes(data);source.chmod(0o600)
    (folder/'render.py').write_text(Path(__file__).with_name('image_preview.py').read_text())
    paths=[]
    try:
        result=subprocess.run(preview_namespace(folder)+['/usr/bin/python3','/work/render.py',evidence['mime']],
            capture_output=True,timeout=25,preexec_fn=render_limits,env={'PATH':'/usr/bin:/bin'})
        if result.returncode:raise ValueError('preview_failed')
        paths=sorted(folder.glob('preview-*.png'))
        if not 0<len(paths)<=(MAX_PREVIEWS if evidence['mime']=='application/pdf' else 1):raise ValueError('preview_count')
        for path in paths:
            if path.is_symlink() or not re.fullmatch(r'preview-[0-9]{1,3}\.png',path.name) or not path.is_file() or path.stat().st_size>10*1024*1024:raise ValueError('invalid_preview')
            with path.open('rb') as image:header=image.read(24)
            if len(header)<24 or header[:8]!=b'\x89PNG\r\n\x1a\n' or not all(0<int.from_bytes(header[n:n+4],'big')<=1600 for n in [16,20]):raise ValueError('invalid_preview')
            path.chmod(0o600)
    except Exception:
        for path in folder.glob('preview-*.png'):path.unlink(missing_ok=True)
        return [],{**evidence,'state':'preview_unavailable','previews':0}
    finally:source.unlink(missing_ok=True)
    if expires is not None and expires<=time.time()*1000:
        for path in paths:path.unlink(missing_ok=True)
        return [],{**evidence,'state':'expired','previews':0}
    return paths,{**evidence,'state':'prepared','previews':len(paths),'maxDimension':1600,
        'scope':'First at most three PDF pages or one image; resized previews. Remaining pages were not inspected.'}
