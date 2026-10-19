// Reusing a flow preserves still-valid emailed links after a suppressed resend.
// Hosted reuse uses a host-only prefix so sibling domains cannot plant the nonce.
export const fairLoginEnabled=env=>env.READER_MODE==='staging'&&env.LOGIN_FAIR_ALLOWANCE==='1';
export const loginFlowName=env=>fairLoginEnabled(env)&&env.LOCAL_READER!=='1'?'__Host-p2s_login_flow':'p2s_login_flow';
const flowPattern=/^(?:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}){2}$/;
export const reusableLoginFlow=value=>typeof value==='string'&&flowPattern.test(value)?value:crypto.randomUUID()+crypto.randomUUID();
