const fs = require('fs')
const path = require('path')
const Telegraf = require('telegraf')
const Composer = require('telegraf/composer')
const session = require('telegraf/session')
const rateLimit = require('telegraf-ratelimit')
const I18n = require('telegraf-i18n')
const { db } = require('./database')
const { onlyGroup, onlyAdmin } = require('./middlewares')
const {
  handleHelp,
  handleQuote,
  handleGetQuote,
  handleTopQuote,
  handleRandomQuote,
  handleColorQuote,
  handleEmojiBrandQuote,
  handleSettingsHidden,
  handleGabSettings,
  handleSave,
  handleDelete,
  handleRate,
  handleEmoji,
  handleSettingsRate,
  handlePrivacy,
  handleLanguage,
  handleFstik,
  handleChatMember,
  handleInlineQuery
} = require('./handlers')
const { getUser, getGroup } = require('./helpers')
const { measureApiLatency, measureProcessUpdate } = require('./middlewares/metrics')

const randomInteger = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min

const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: { webhookReply: false },
  handlerTimeout: 1
});

(async () => {
  console.log(await bot.telegram.getMe())
})()

bot.use((ctx, next) => {
  next().catch((error) => {
    console.log('Oops', error)
  })
  return true
})

bot.use(measureProcessUpdate)
bot.use(measureApiLatency)

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'))

bot.use((ctx, next) => {
  ctx.config = config
  ctx.db = db
  return next()
})

bot.use(handleChatMember)

bot.use(
  Composer.groupChat(
    Composer.command(
      rateLimit({
        window: 1000 * 5,
        limit: 2,
        keyGenerator: (ctx) => ctx.chat.id,
        onLimitExceeded: ({ deleteMessage }) => deleteMessage().catch(() => {})
      })
    )
  )
)

bot.use(
  Composer.mount(
    'callback_query',
    rateLimit({
      window: 2000,
      limit: 1,
      keyGenerator: (ctx) => ctx.from.id,
      onLimitExceeded: ({ answerCbQuery }) => answerCbQuery('too fast', true)
    })
  )
)

bot.on(['channel_post', 'edited_channel_post'], () => {})

const i18n = new I18n({
  directory: path.resolve(__dirname, 'locales'),
  defaultLanguage: '-'
})

bot.use(i18n.middleware())

bot.use(
  session({
    getSessionKey: (ctx) => {
      if (ctx.from && ctx.chat) {
        return `${ctx.from.id}:${ctx.chat.id}`
      } else if (ctx.from) {
        return `user:${ctx.from.id}`
      }
      return null
    },
    ttl: 60 * 5
  })
)

bot.use(async (ctx, next) => {
  console.log('set ctx.state.emptyRequest = false')
  ctx.state.emptyRequest = false
  return next()
})

bot.use(
  Composer.groupChat(
    session({
      property: 'group',
      getSessionKey: (ctx) => {
        if (
          ctx.from &&
          ctx.chat &&
          ['supergroup', 'group'].includes(ctx.chat.type)
        ) {
          return `${ctx.chat.id}`
        }
        return null
      },
      ttl: 60 * 5
    })
  )
)

const updateGroupAndUser = async (ctx, next) => {
  await getUser(ctx)
  await getGroup(ctx)
  return next(ctx).then(async () => {
    console.log(`ctx.state.emptyRequest = ${ctx.state.emptyRequest}`)
    if (ctx.state.emptyRequest === false) {
      ctx.session.userInfo.save().catch(() => {})
      const memberCount = await ctx.telegram.getChatMembersCount(ctx.chat.id)
      if (memberCount) ctx.group.info.memberCount = memberCount
      await ctx.group.info.save().catch(() => {})
    }
  })
}

bot.use(async (ctx, next) => {
  if (ctx.inlineQuery) {
    await getUser(ctx)
    ctx.state.answerIQ = []
  }
  if (ctx.callbackQuery) {
    await getUser(ctx)
    ctx.state.answerCbQuery = []
  }

  return next(ctx).then(() => {
    if (ctx.inlineQuery) return ctx.answerInlineQuery(...ctx.state.answerIQ)
    if (ctx.callbackQuery) return ctx.answerCbQuery(...ctx.state.answerCbQuery)
  })
})

bot.use(Composer.groupChat(Composer.command(updateGroupAndUser)))

bot.use(
  Composer.privateChat(async (ctx, next) => {
    await getUser(ctx)
    await next(ctx).then(() => {
      ctx.session.userInfo.save().catch(() => {})
    })
  })
)

bot.on(
  'message',
  Composer.privateChat((ctx, next) => {
    if (ctx.i18n.languageCode === '-') return handleLanguage(ctx, next)
    return next()
  })
)

bot.start(async (ctx, next) => {
  const arg = ctx.message.text.split(' ')
  if (arg[1]) {
    await ctx.tg.sendMessage(
      ctx.config.adminId,
      `#${arg[1]}\n<code>${JSON.stringify(ctx.message, null, 2)}</code>`,
      {
        parse_mode: 'HTML'
      }
    )
  }
  return next()
})

bot.command('qtop', onlyGroup, handleTopQuote)
bot.command(
  'qrand',
  onlyGroup,
  rateLimit({
    window: 1000 * 50,
    limit: 2,
    keyGenerator: (ctx) => {
      return ctx.chat.id
    },
    onLimitExceeded: ({ deleteMessage }) => deleteMessage().catch(() => {})
  }),
  handleRandomQuote
)

bot.command('q', handleQuote)
bot.hears(/\/q_(.*)/, handleGetQuote)
bot.hears(/^\/qs(?:\s([^\s]+)|)/, handleFstik)
bot.hears(/^\/qs(?:\s([^\s]+)|)/, onlyGroup, onlyAdmin, handleSave)
bot.command('qd', onlyGroup, onlyAdmin, handleDelete)
bot.hears(/^\/qcolor(?:(?:\s(?:(#?))([^\s]+))?)/, onlyAdmin, handleColorQuote)
bot.command('qb', onlyAdmin, handleEmojiBrandQuote)
bot.hears(/^\/(hidden)/, onlyAdmin, handleSettingsHidden)
bot.command('qemoji', onlyAdmin, handleEmoji)
bot.hears(/^\/(gab) (\d+)/, onlyGroup, onlyAdmin, handleGabSettings)
bot.hears(/^\/(qrate)/, onlyGroup, onlyAdmin, handleSettingsRate)
bot.action(/^(rate):(👍|👎)/, handleRate)
bot.action(/^(irate):(.*):(👍|👎)/, handleRate)

bot.on('new_chat_members', (ctx, next) => {
  if (ctx.message.new_chat_member.id === ctx.botInfo.id) return handleHelp(ctx)
  else return next()
})

bot.start(handleHelp)
bot.command('help', handleHelp)

bot.use(handleInlineQuery)

bot.command('privacy', onlyAdmin, handlePrivacy)

bot.command('lang', handleLanguage)
bot.action(/set_language:(.*)/, handleLanguage)

bot.on('message', Composer.privateChat(handleQuote))

bot.on(
  'message',
  Composer.groupChat(
    rateLimit({
      window: 1000 * 5,
      limit: 1,
      keyGenerator: (ctx) => ctx.chat.id,
      onLimitExceeded: (ctx, next) => {
        ctx.state.skip = true
        return next()
      }
    }),
    async (ctx, next) => {
      if (ctx.state.skip) return next()
      await getGroup(ctx)
      const gab = ctx.group.info.settings.randomQuoteGab

      if (gab > 0) {
        if (
          randomInteger(0, gab) === gab &&
          ctx.group.info.lastRandomQuote.getTime() / 1000 <
            Date.now() / 1000 - 60
        ) {
          ctx.group.info.lastRandomQuote = Date()
          ctx.state.randomQuote = true
          return handleRandomQuote(ctx)
        }
      }
      return next()
    }
  )
)

bot.use((ctx, next) => {
  console.log('set ctx.state.emptyRequest = true')
  ctx.state.emptyRequest = true
  return next()
})

db.connection.once('open', async () => {
  console.log('Connected to MongoDB')

  if (process.env.BOT_DOMAIN) {
    bot
      .launch({
        webhook: {
          domain: process.env.BOT_DOMAIN,
          hookPath: `/QuoteBot:${process.env.BOT_TOKEN}`,
          port: process.env.WEBHOOK_PORT || 2200
        }
      })
      .then(() => {
        console.log('bot start webhook')
      })
  } else {
    // const updates = await bot.telegram.callApi('getUpdates', { offset: -1 })
    // const offset = updates.length && updates[0].update_id + 1
    // if (offset) {
    //   await bot.telegram.callApi('getUpdates', { offset })
    // }
    await bot.launch().then(() => {
      console.log('bot start polling')
    })
  }
})
