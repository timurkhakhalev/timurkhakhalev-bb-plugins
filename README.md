# Browser Annotate

Плагин переносит в BB основной сценарий Browser comments из Codex App: пользователь выбирает элементы страницы, оставляет комментарии, а затем отправляет их вместе со своим следующим сообщением.

## Сценарий

1. Откройте страницу во встроенном Browser.
2. Нажмите **Annotate** прямо в панели Browser рядом с адресной строкой.
3. Выберите DOM-элемент, напишите комментарий и сохраните его.
4. После каждого сохранения плашка в composer сразу обновляет число и список аннотаций. Из неё можно изменить или удалить отдельный комментарий либо убрать весь batch.
5. Повторите это для остальных элементов. Маркер на странице также можно открыть, чтобы изменить или удалить комментарий.
6. Нажмите **Send** в компактной панели **Annotate Page**.
7. Live-плашка остаётся в composer, а batch становится mention `N annotations`. Допишите обычный запрос и отправьте его штатной кнопкой.

`Escape`, крестик на composer-плашке или повторное нажатие **Annotate** завершают сессию без добавления комментариев в итоговый запрос.

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

Текст и изображения страницы явно помечены как недоверенные page evidence. Только поле `Comment` считается пользовательской инструкцией.

## Поток данных

```text
Browser toolbar action
  -> server resolves the active thread/tab to a desktop Browser instance
  -> host acquires the tab and injects the element picker
  -> every saved comment queues an immediate CDP screenshot
  -> composer polls the live revision and renders the current annotation list
  -> edit/delete actions update the same page overlay
  -> Send stores the screenshots in thread storage
  -> app finalizes the live card as a Browser comments mention
  -> normal user submit resolves the mention
  -> agent-only text + labeled localImage inputs are appended to that turn
```

Плагин не вызывает `threads.send`: итоговый turn всегда проходит через текущий composer и сохраняет выбранные пользователем модель, reasoning level, permission mode и правила очереди.

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
- Сессия ограничена 25 минутами, lease — 30 минутами.
- Pending batches живут в памяти server-процесса до 24 часов; перезапуск плагина их очищает.

## Проверка

```sh
bun install
bun run check
bb plugin build
```

До публикации соответствующей версии SDK плагин использует vendored declarations в `types/` и требует companion-изменения из `bb/`.
