## Summary

A queued message remains eligible for automatic dispatch while its inline editor is open. When the current turn finishes, BB can send the original saved text, remove the queue row, and dismiss the editor while the user is still typing. The edited item should remain unsent until Save or Cancel.

## Versions and environment

- Reported in BB desktop / bundled CLI **0.45.0**, macOS **26.6.2**, local execution.
- Isolated source test: public main at **ee8415ca0930694ce6781e64ec0cf42e8cd5358a**, Node **24.12.0**.
- The edit hook is byte-identical between desktop-v0.45.0 and the inspected main.
- Shared UI/server queue lifecycle; no provider was needed for the isolated test.

## Steps to reproduce

1. Start a turn that stays active long enough to edit a follow-up.
2. Queue the synthetic message `ORIGINAL`.
3. Choose **Edit queued message**, replace the draft with `UNSAVED EDIT`, and keep the editor open without saving or cancelling.
4. Let the current turn finish normally.
5. The queue item is dispatched using its original text, and its editor disappears during editing.

Independent verification mounts the actual React edit hook and uses actual queue claim/update/consume functions in a migrated in-memory SQLite DB. Turn completion is simulated by changing the stored thread status from active to idle; no real provider prompt was sent. This verifies the missing edit/claim exclusion and editor dismissal at the underlying code paths, rather than a fresh end-to-end desktop recording.

Save the two scripts below as `build-queue-hook.mjs` in a scratch source checkout at the commit above and `/tmp/bb-queued-edit-repro.mjs`, then run:

```sh
pnpm --filter bb --filter @bb/db... --filter @bb/client-core... --filter bb-plugin-provider-acp... install --frozen-lockfile --ignore-scripts
pnpm -r rebuild better-sqlite3
node build-queue-hook.mjs
node --conditions=source --import tsx /tmp/bb-queued-edit-repro.mjs
```

The fixture opens the real editor hook, changes the local draft, and verifies that the DB still contains ORIGINAL. The queue claim is initially ineligible while the simulated thread is active. Once the thread is set idle, the claim succeeds while the editor remains open. Saving is rejected, and consuming the row plus rerendering the hook with the empty queue dismisses the editor.

## Expected vs actual

Captured output:

```json
{
  "editorOpened": true,
  "unsavedDraft": "UNSAVED EDIT",
  "storedContentAtEdit": "ORIGINAL",
  "automaticClaimWhileEditing": true,
  "claimedContent": "ORIGINAL",
  "saveDuringClaim": "claimed",
  "saveAfterConsume": "not_found",
  "editorAfterQueueRemoval": "dismissed"
}
```

Expected:

- Opening the inline editor makes that queue item ineligible for automatic dispatch until Save or Cancel.
- Finishing the current turn must not consume that item, send its pre-edit text, or dismiss the editor.
- Save atomically updates content and releases the edit hold; Cancel explicitly discards the draft and releases the original item.
- Begin-edit admission and dispatch claiming must have an atomic order. If dispatch already won, do not present an editable item; if editing won, defer its dispatch.
- Save-time conflicts are not a substitute for protecting the message while the user edits it.

## Evidence and root cause

- [Begin edit](https://github.com/get-bb/bb/blob/ee8415ca0930694ce6781e64ec0cf42e8cd5358a/apps/app/src/components/thread/embedded-chat/useInlineQueuedMessageEditing.ts#L115-L135) only copies content into local React state and remembers expectedUpdatedAt. No server hold is acquired.
- The begin-edit callbacks only clear attachment errors and move focus: [thread detail](https://github.com/get-bb/bb/blob/ee8415ca0930694ce6781e64ec0cf42e8cd5358a/apps/app/src/views/thread-detail/ThreadDetailPromptArea.tsx#L494-L501), [embedded chat](https://github.com/get-bb/bb/blob/ee8415ca0930694ce6781e64ec0cf42e8cd5358a/apps/app/src/components/thread/embedded-chat/EmbeddedThreadChat.tsx#L328-L335).
- [Completed-turn handling](https://github.com/get-bb/bb/blob/ee8415ca0930694ce6781e64ec0cf42e8cd5358a/apps/server/src/internal/events.ts#L474-L483) schedules a thread-ready queue-dispatch wake when the thread becomes idle.
- [Automatic eligibility](https://github.com/get-bb/bb/blob/ee8415ca0930694ce6781e64ec0cf42e8cd5358a/apps/server/src/services/threads/queued-messages.ts#L132-L176) checks failure and wait state. A thread-busy row becomes eligible once the thread is idle; the browser's edit session is not represented there.
- [Automatic drain](https://github.com/get-bb/bb/blob/ee8415ca0930694ce6781e64ec0cf42e8cd5358a/apps/server/src/services/threads/queued-messages.ts#L846-L884) claims and dispatches the next eligible group. [DB claiming](https://github.com/get-bb/bb/blob/ee8415ca0930694ce6781e64ec0cf42e8cd5358a/packages/db/src/data/queued-thread-messages.ts#L1035-L1078) has no edit reservation to exclude it.
- [Editor disappearance](https://github.com/get-bb/bb/blob/ee8415ca0930694ce6781e64ec0cf42e8cd5358a/apps/app/src/components/thread/embedded-chat/useInlineQueuedMessageEditing.ts#L90-L113): absence from queuedMessages makes visible editing state null and triggers dismissal.
- [Update contract](https://github.com/get-bb/bb/blob/ee8415ca0930694ce6781e64ec0cf42e8cd5358a/packages/server-contract/src/api/threads.ts#L378-L384) carries only input and expectedUpdatedAt. This protects saves from overwriting newer data, but does not prevent dispatch while typing.
- [Update rejection](https://github.com/get-bb/bb/blob/ee8415ca0930694ce6781e64ec0cf42e8cd5358a/apps/server/src/routes/threads/actions.ts#L324-L354) maps a claimed row to 409, "Queued message is already being sent", and a consumed row to 404. The fixture independently observes claimed/not_found from the underlying DB operations.

Minimal direction: establish a server-recognized hold or move-to-draft transition when editing begins. Queue claiming/grouping and edit completion must respect that transition. A browser-local focus guard alone cannot prevent server or other-client dispatch.

## What was ruled out / verification limits

- No Save or auto-save precedes the claim; the claimed content is the original stored text.
- This is not provider-specific parsing, model selection, or an optimistic-concurrency overwrite.
- No exact duplicate found in open/closed issues and PRs searched for queued/editing, queue race, hold, and draft disappearance.
- [#1585](https://github.com/get-bb/bb/issues/1585) proposes keyboard entry to editing and treats save-time checks as safe when a message flushes mid-edit. This report requests protection from that dispatch itself.
- [#1864](https://github.com/get-bb/bb/issues/1864) concerns changing execution settings in the queued editor, not suppressing dispatch during editing.
- No new live desktop/daemon/provider reproduction was performed. Source inspection and the actual UI-hook/SQLite assertions corroborate the reported live symptom. Provider delivery and global draft recoverability were not independently exercised.
- The fixture uses synthetic content and an in-memory DB; no user conversation text, credentials, personal paths, or private entity IDs are included.

## Suggested priority and effort

Medium: editing can send stale instructions and dismiss unsaved work without user consent. Merely keeping the editor visible would preserve a draft but would still send the wrong message; the fix needs coordinated edit/queue lifecycle behavior.

## Checks

- [x] Verified current-main code paths and stated reproduction limits.
- [x] Searched open and closed issues/PRs for duplicates.
- [x] Included the source-backed investigation report, executable fixture, sanitized evidence, and agent marker.

## Runnable fixture

<details>
<summary>build-queue-hook.mjs</summary>

```javascript
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('packages/plugin-sdk/package.json'));
const react = require.resolve('react');
await build({
  entryPoints: ['apps/app/src/components/thread/embedded-chat/useInlineQueuedMessageEditing.ts'],
  bundle: true, platform: 'node', format: 'esm', conditions: ['source'],
  outfile: '/tmp/bb-queued-edit-hook.mjs',
  alias: { react, '@bb/client-core': resolve('packages/client-core/src/prompt/threadQueuedMessages.ts') },
  external: [react],
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
```

</details>

<details>
<summary>queued-edit-repro.mjs</summary>

```javascript
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const root=process.cwd();
const require=createRequire(join(root,'packages/plugin-sdk/package.json'));
const { JSDOM }=require('jsdom');
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/'});
for (const key of ['window','document','navigator','HTMLElement','Node']) Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
const {renderHook,act,cleanup}=require('@testing-library/react');
const {useInlineQueuedMessageEditing}=await import('/tmp/bb-queued-edit-hook.mjs');
const dbApi=await import(pathToFileURL(join(root,'packages/db/src/index.ts')));
const {createConnection,migrate,createProject,createThread,upsertHost,createQueuedThreadMessage,claimNextQueuedThreadMessageGroup,updateQueuedThreadMessage,deleteClaimedQueuedThreadMessageBatchInTransaction,listQueuedThreadMessages,noopNotifier}=dbApi;
const db=createConnection(':memory:');migrate(db);
try {
 const host=upsertHost(db,noopNotifier,{name:'synthetic-host'});
 const {project}=createProject(db,noopNotifier,{name:'synthetic-project',source:{type:'local_path',hostId:host.id,path:'/tmp/synthetic-workspace'}});
 const thread=createThread(db,noopNotifier,{projectId:project.id,providerId:'fixture',status:'active'});
 const input=text=>[{type:'text',text,mentions:[]}];
 const row=createQueuedThreadMessage(db,noopNotifier,{threadId:thread.id,content:input('ORIGINAL'),model:'fixture/model',reasoningLevel:'medium',permissionMode:'full',serviceTier:'default',waitingOn:{kind:'thread-busy'},sendAt:null,payload:{kind:'inline'},systemNotice:null});
 const uiRow={...row,content:JSON.parse(row.content)};
 let beginCallbacks=0;
 const props={ownerThreadId:thread.id,queuedMessages:[uiRow],onBeginEdit:()=>beginCallbacks++};
 const {result,rerender}=renderHook(p=>useInlineQueuedMessageEditing(p),{initialProps:props});
 act(()=>result.current.beginEditQueuedMessage({queuedMessageId:row.id,queuedMessageIndex:0}));
 act(()=>result.current.queuedMessageDraftSession.setDraft(d=>({...d,text:'UNSAVED EDIT'})));
 assert.equal(result.current.inlineEditingQueuedMessage.draft.text,'UNSAVED EDIT');
 assert.equal(beginCallbacks,1);
 assert.equal(listQueuedThreadMessages(db,thread.id)[0].content,JSON.stringify(input('ORIGINAL')));
 const eligible=()=>dbApi.getThread(db,thread.id).status==='idle';
 assert.equal(claimNextQueuedThreadMessageGroup(db,noopNotifier,thread.id,eligible),null);
 db.update(dbApi.threads).set({status:'idle'}).run();
 const claims=claimNextQueuedThreadMessageGroup(db,noopNotifier,thread.id,eligible);
 assert.equal(claims.length,1);
 assert.equal(JSON.parse(claims[0].content)[0].text,'ORIGINAL');
 assert.equal(result.current.inlineEditingQueuedMessage.draft.text,'UNSAVED EDIT');
 const saveWhileClaimed=updateQueuedThreadMessage(db,noopNotifier,{id:row.id,threadId:thread.id,expectedUpdatedAt:row.updatedAt,content:input('UNSAVED EDIT')});
 assert.equal(saveWhileClaimed.kind,'claimed');
 const removed=db.transaction(tx=>deleteClaimedQueuedThreadMessageBatchInTransaction(tx,{queuedMessages:claims}));
 assert(removed);
 const saveAfterConsumed=updateQueuedThreadMessage(db,noopNotifier,{id:row.id,threadId:thread.id,expectedUpdatedAt:row.updatedAt,content:input('UNSAVED EDIT')});
 assert.equal(saveAfterConsumed.kind,'not_found');
 rerender({...props,queuedMessages:[]});
 assert.equal(result.current.inlineEditingQueuedMessage,null);
 assert.equal(result.current.inlineEditingQueuedMessageRef.current,null);
 console.log(JSON.stringify({source:'main ee8415ca0930694ce6781e64ec0cf42e8cd5358a',editorOpened:true,unsavedDraft:'UNSAVED EDIT',storedContentAtEdit:'ORIGINAL',automaticClaimWhileEditing:true,claimedContent:'ORIGINAL',saveDuringClaim:saveWhileClaimed.kind,saveAfterConsume:saveAfterConsumed.kind,editorAfterQueueRemoval:'dismissed',scope:'actual UI hook and SQLite claim/consume functions; turn completion simulated by active-to-idle DB status transition; no provider prompt sent'},null,2));
 cleanup();
}finally{db.$client.close();dom.window.close();}
```

</details>

> AGENT GENERATED
