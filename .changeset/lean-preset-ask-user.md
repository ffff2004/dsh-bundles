---
"@ffff2004-dsh-packages/lean-preset": minor
---

三个 preset 挂载 `@deepseek-ai/dsh-tool-ask-user`，提供 `ask_user_question`：在需要确认、选择或补充信息时向用户发起结构化提问，答案作为普通工具结果返回。它使用宿主的 `userQuestions` 服务，需要可交互的 UI 回答者；此前本 bundle 明确不挂载该工具，需要提问只能写在普通回复里。
