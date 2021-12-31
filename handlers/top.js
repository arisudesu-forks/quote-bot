const Markup = require('telegraf/markup')
const { crypto } = require('../utils')

module.exports = async ctx => {
  const resultText = ctx.i18n.t('top.info')
  const cryptId = crypto.encryptData(process.env.SECRET_KEY, ctx.chat.id.toString());

  await ctx.replyWithHTML(resultText, {
    reply_to_message_id: ctx.message.message_id,
    reply_markup: Markup.inlineKeyboard([
      Markup.switchToCurrentChatButton(
        ctx.i18n.t('top.open'),
        `top:${cryptId}`
      )
    ])
  })
}
