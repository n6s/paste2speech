export function setupDomainMoveNotice() {
  const notice = document.querySelector('.domain-move');
  const url = new URL(location.href);
  if (!notice || url.searchParams.get('from') !== 'legacy') return;
  notice.hidden = false;
  url.searchParams.delete('from');
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
}
