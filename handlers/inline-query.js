const Composer = require('telegraf/composer')
const Markup = require('telegraf/markup')

const composer = new Composer()

composer.on('inline_query', async (ctx) => {
  const stickersResult = []

  const likedQuote = await ctx.db.Quote.find({ 'rate.votes.0.vote': ctx.session.userInfo._id.toString() }).sort({
    'rate.score': -1
  }).limit(50)

  likedQuote.forEach(quote => {
    stickersResult.push({
      type: 'sticker',
      id: quote._id,
      sticker_file_id: quote.file_id,
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.callbackButton(`👍 ${quote.rate.votes[0].vote.length || ''}`, `irate:${quote._id}:👍`),
          Markup.callbackButton(`👎 ${quote.rate.votes[1].vote.length || ''}`, `irate:${quote._id}:👎`)
        ]
      ])
    })
  })

  ctx.state.answerIQ = [stickersResult, {
    is_personal: true,
    cache_time: 5
  }]
})

module.exports = composer
