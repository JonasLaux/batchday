import { getChatGPTAccount, loginChatGPT, logoutChatGPT } from '../src/lib/chatgpt-auth.ts'

try {
  const argument = process.argv[2]
  if (process.argv.length > 3 || (argument && !['--status', '--logout', '--new-account'].includes(argument))) {
    throw new Error('Usage: pnpm chatgpt:login [--status | --logout | --new-account]')
  }
  if (argument === '--status') {
    const account = await getChatGPTAccount()
    console.log(account ? `ChatGPT connected: ${account.email || 'your account'}` : 'ChatGPT is not connected. Run pnpm chatgpt:login.')
  } else if (argument === '--logout') {
    const revoked = await logoutChatGPT()
    console.log(revoked ? 'ChatGPT disconnected.' : 'ChatGPT disconnected locally. Remote revocation was not confirmed; disconnect Batchday in ChatGPT Settings → Apps.')
  } else {
    const account = await loginChatGPT((url, callback) => {
      console.log('Continue with ChatGPT. Open this URL in your browser and allow Batchday to use your ChatGPT plan:')
      console.log(url)
      console.log(`\nCallback: ${callback}`)
      console.log('On a headless server, forward this callback port over SSH before completing sign-in. See README.md.')
    }, argument === '--new-account')
    console.log(`\nConnected ${account.email || 'your ChatGPT account'}. Eligible recipe requests use your ChatGPT plan.`)
    console.log('Manage usage: https://chatgpt.com/settings/usage')
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'ChatGPT sign-in failed.')
  process.exitCode = 1
}
