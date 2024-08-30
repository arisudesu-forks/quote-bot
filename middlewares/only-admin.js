module.exports = async (ctx, next) => {
  if (['supergroup', 'group'].includes(ctx.chat.type)) {
    const chatMember = await ctx.telegram.getChatMember(
      ctx.message.chat.id,
      ctx.message.from.id
    ).catch(console.error)

    if (chatMember && ['creator', 'administrator'].includes(chatMember.status)) {
      return next()
    } else {
      await ctx.replyWithHTML(ctx.i18n.t('only_admin'), {
        reply_to_message_id: ctx.message.message_id
      })
    }
  } else {
    return next()
  }
}
