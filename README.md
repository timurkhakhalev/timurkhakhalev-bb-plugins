# Browser Annotate

Плагин переносит в BB основной сценарий Browser comments из Codex App: пользователь выбирает элементы страницы, оставляет комментарии, а затем отправляет их вместе со своим следующим сообщением.

## Сценарий

1. Откройте страницу во встроенном Browser.
2. Нажмите **Annotate** прямо в панели Browser рядом с адресной строкой.
3. Выберите DOM-элемент, напишите комментарий и сохраните его.
4. После каждого сохранения banner-плашка над полем composer сразу обновляет число и список аннотаций. Список раскрывается по наведению; из него можно изменить или удалить отдельный комментарий либо убрать весь batch.
5. Повторите это для остальных элементов. Маркер на странице также можно открыть, чтобы изменить или удалить комментарий.
6. Нажмите **Send** в компактной панели **Annotate Page**.
7. Плагин сразу отправляет в текущий чат одно сообщение `N annotations` с полным контекстом и снимками. Live-плашка исчезает, а список отправленных аннотаций доступен по наведению на mention в истории.

`Escape` и повторное нажатие **Annotate** выключают picker, но сохраняют уже добавленные annotations в composer. Удаление mention из composer удаляет весь несохранённый batch.

## Что получает агент

При отправке mention разрешается в скрытые от пользователя agent-only inputs:

- блок `# Browser comments:` с отдельной секцией для каждого комментария;
- URL и frame URL;
- target, role, CSS selector и DOM path;
- metadata атрибутов элемента;
- координаты элемента и viewport;
- immediate, nearby и selected text;
- тема интерфейса в момент сохранения;
- отдельный JPEG для каждого комментария, снятый сразу после сохранения выделения.

Текст и изображения страницы явно помечены как недоверенные page evidence. Editor исполняется в отдельном CDP isolated world и закрытом Shadow DOM, поэтому страница не может прочитать или подменить пользовательский комментарий и Send intent. Только поле `Comment` считается пользовательской инструкцией.

## Поток данных

```text
Browser toolbar action
  -> server resolves the active thread/tab to a desktop Browser instance
  -> host acquires the tab and injects the picker into an isolated world
  -> trusted editor lives in a closed Shadow DOM; the page supplies only untrusted element evidence
  -> server persists every saved revision as the authoritative draft
  -> every saved or edited comment queues a versioned CDP screenshot
  -> composer polls the live revision and renders the current annotation list
  -> edit/delete actions update the same page overlay
  -> reload reinjects the picker from the persisted draft; navigation pauses the previous page batch
  -> Send drains the capture queue and stores current-version screenshots in thread storage
  -> batch metadata is persisted beside the screenshots for message hover details
  -> server sends one Browser comments mention to the current thread
  -> send resolves the mention
  -> agent-only text + labeled localImage inputs are appended to that turn
```

`Send` вызывает `threads.send` в режиме `steer-if-active`: в свободном чате сообщение запускается сразу, а во время активной работы передаётся агенту как steering-сообщение. Модель, reasoning level и permission mode берутся из настроек текущего thread.

## Состав

- `src/app.tsx` — кнопка в Browser toolbar и bridge в composer.
- `src/server.ts` — Browser lease, pending batches, mention provider и thread storage.
- `src/host.ts` — CDP-клиент, picker и снимки каждого сохранённого элемента.
- `src/contracts.ts` — Zod-контракты frontend/server/host.
- `src/server.test.ts` — проверки prompt-формата и входных границ.
- `bb/` — companion-изменения BB: Browser toolbar slot и image inputs для mention providers.

## Ограничения

- Поддерживается desktop BB с нативным Browser.
- Выбираются DOM-элементы верхнего документа; cross-origin iframe, произвольные области и virtual targets пока не поддержаны.
- До 50 комментариев за batch.
- Browser lease ограничен 30 минутами.
- Pending batches сохраняются в thread storage и индексируются в plugin KV. Они восстанавливаются после reload страницы и перезапуска плагина и истекают через 24 часа.

## Проверка

```sh
bun install
bun run check
bb plugin build
```

До публикации соответствующей версии SDK плагин использует vendored declarations в `types/` и требует companion-изменения из `bb/`.
