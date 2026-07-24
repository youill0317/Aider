import * as fs from 'fs'
import * as path from 'path'

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/ChatView.tsx'),
  'utf8',
)

test('always unmounts the chat view after attempting abort and save', () => {
  expect(source).toContain('await this.chatRef.current?.abortActiveWork()')
  expect(source).toContain('await this.chatRef.current?.flushPendingSave()')
  expect(source).toContain('} finally {')
  expect(source).toContain('this.root?.unmount()')
  expect(source).toContain('redactSecrets(errors)')
})

test('consumes pending initial chat props only once', () => {
  expect(source).toContain('this.initialChatProps = plugin.initialChatProps')
  expect(source).toContain('plugin.initialChatProps = undefined')
})
