const Markup = require('telegraf/markup')
const {
  tdlib
} = require('../helpers')
const Telegram = require('telegraf/telegram')
const fs = require('fs')
const got = require('got')
const EmojiDbLib = require('emoji-db')

const emojiDb = new EmojiDbLib({ useDefaultDb: true })
const emojiArray = Object.values(emojiDb.dbData).filter(data => {
  if (data.emoji) return true
})

const telegram = new Telegram(process.env.BOT_TOKEN)

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'))

// TODO: read pack name from config
// for create global sticker pack
// telegram.createNewStickerSet(66478514, 'created_by_QuotLyBot', 'Created by @QuotLyBot', {
//   png_sticker: { source: 'placeholder.png' },
//   emojis: '💜'
// }).then(console.log)

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function loopClearStickerPack () {
  setInterval(async () => {
    const me = await telegram.getMe()
    const sticketSet = await telegram.getStickerSet(config.globalStickerSet.name + me.username).catch(console.error)
    if (!sticketSet) return
    for (const i in sticketSet.stickers) {
      const sticker = sticketSet.stickers[i]
      if (i > config.globalStickerSet.save_sticker_count - 1) {
        telegram.deleteStickerFromSet(sticker.file_id).catch(console.error)
      }
    }
  }, 500)
}

loopClearStickerPack()

const hashCode = (s) => {
  const l = s.length
  let h = 0
  let i = 0
  if (l > 0) {
    while (i < l) {
      h = (h << 5) - h + s.charCodeAt(i++) | 0
    }
  }
  return h
}

const generateRandomColor = () => {
  const rawColor = (Math.floor(Math.random() * 16777216)).toString(16)
  const color = '0'.repeat(6 - rawColor.length) + rawColor
  return `#${color}`
}

const minIdsInChat = {}

module.exports = async (ctx, next) => {
  if (ctx.chat.type === 'private') {
    return
  }

  const flag = {
    count: false,
    reply: false,
    png: false,
    img: false,
    rate: false,
    color: false,
    scale: false,
    crop: false,
    privacy: false
  }

  if (ctx.message && ctx.message.text && ctx.message.text.match(/\/q/)) {
    const args = ctx.message.text.split(' ')
    args.splice(0, 1)

    flag.count = args.find((arg) => !isNaN(parseInt(arg)))
    flag.reply = args.find((arg) => ['r', 'reply'].includes(arg))
    flag.png = args.find((arg) => ['p', 'png'].includes(arg))
    flag.img = args.find((arg) => ['i', 'img'].includes(arg))
    flag.rate = args.find((arg) => ['rate'].includes(arg))
    flag.hidden = args.find((arg) => ['h', 'hidden'].includes(arg))
    flag.media = args.find((arg) => ['m', 'media'].includes(arg))
    flag.scale = args.find((arg) => arg.match(/s([+-]?(?:\d*\.)?\d+)/))
    flag.crop = args.find((arg) => ['c', 'crop'].includes(arg))
    flag.color = args.find((arg) => (!Object.values(flag).find((f) => arg === f)))

    if (flag.scale) flag.scale = flag.scale.match(/s([+-]?(?:\d*\.)?\d+)/)[1]
  } else if (ctx.chat.type === 'private') {
    if (!minIdsInChat[ctx.from.id]) minIdsInChat[ctx.from.id] = ctx.message.message_id
    minIdsInChat[ctx.from.id] = Math.min(minIdsInChat[ctx.from.id], ctx.message.message_id)
    await sleep(1000)
    if (minIdsInChat[ctx.from.id] !== ctx.message.message_id) return next()
    delete minIdsInChat[ctx.from.id]
  }

  await ctx.replyWithChatAction('choose_sticker')

  // set background color
  let backgroundColor

  if (flag.color) {
    if (flag.color === 'random') {
      backgroundColor = generateRandomColor()
    } else {
      backgroundColor = flag.color
    }
  } else if (ctx.group && ctx.group.info.settings.quote.backgroundColor) {
    backgroundColor = ctx.group.info.settings.quote.backgroundColor
  } else if (ctx.session.userInfo.settings.quote.backgroundColor) {
    backgroundColor = ctx.session.userInfo.settings.quote.backgroundColor
  } else {
    backgroundColor = '#1b1429'
  }

  let emojiBrand = 'apple'
  if (ctx.group && ctx.group.info.settings.quote.emojiBrand) {
    emojiBrand = ctx.group.info.settings.quote.emojiBrand
  } else if (ctx.session.userInfo.settings.quote.emojiBrand) {
    emojiBrand = ctx.session.userInfo.settings.quote.emojiBrand
  }

  if ((ctx.group && ctx.group.info.settings.hidden) || ctx.session.userInfo.settings.hidden) flag.hidden = true

  const maxQuoteMessage = 50
  let messageCount = flag.count || 1

  let quoteMessage = ctx.message.reply_to_message
  if (!quoteMessage && ctx.chat.type === 'private') {
    quoteMessage = ctx.message
    messageCount = maxQuoteMessage
  }

  messageCount = Math.max(Math.min(messageCount, maxQuoteMessage), 0 - maxQuoteMessage)

  if (!quoteMessage) {
    return ctx.replyWithHTML(ctx.i18n.t('quote.empty_forward'), {
      reply_to_message_id: ctx.message.message_id,
      allow_sending_without_reply: true
    })
  }

  const quoteMessages = []

  let startMessage = quoteMessage.message_id

  if (messageCount < 0) {
    messageCount = Math.abs(messageCount)
    startMessage -= messageCount - 1
  }

  let tryDeleted = 0
  const maxTryDeleted = 50

  let lastMessage
  for (let index = 0; index < messageCount; index++) {
    try {
      const getMessages = await tdlib.getMessages(ctx.message.chat.id, [startMessage + index])
      if (getMessages.length > 0 && getMessages[0].message_id) {
        quoteMessage = getMessages[0]
      } else {
        if (index > 0) {
          if (process.env.GROUP_ID) {
            const chatForward = process.env.GROUP_ID
            quoteMessage = await ctx.telegram.forwardMessage(chatForward, ctx.message.chat.id, startMessage + index)
          } else {
            if (tryDeleted < maxTryDeleted) {
              tryDeleted++
              messageCount++
            }
            quoteMessage = null
          }
        }
      }
    } catch (error) {
      console.error(error)
      quoteMessage = null
    }

    // if (index === 0) quoteMessage = ctx.message

    if (ctx.chat.type === 'private' && !quoteMessage) break

    if (!quoteMessage) {
      continue
    }

    let messageFrom

    if (quoteMessage.forward_sender_name) {
      if (flag.hidden) {
        const sarchForwardName = await ctx.db.User.find({
          full_name: quoteMessage.forward_sender_name
        })

        // if (sarchForwardName.length === 0) {
        //   sarchForwardName = await ctx.db.User.find({
        //     $expr: { $eq: [quoteMessage.forward_sender_name, { $concat: ['$first_name', ' ', '$last_name'] }] }
        //   })
        // }\

        if (sarchForwardName.length === 1) {
          messageFrom = {
            id: sarchForwardName[0].telegram_id,
            name: quoteMessage.forward_sender_name,
            username: sarchForwardName[0].username || null
          }

          const getHiddenChat = await ctx.telegram.getChat(sarchForwardName[0].telegram_id).catch(console.error)
          if (getHiddenChat) messageFrom.photo = getHiddenChat.photo
        } else {
          messageFrom = {
            id: hashCode(quoteMessage.forward_sender_name),
            name: quoteMessage.forward_sender_name,
            username: 'HiddenSender'
          }
        }
      } else {
        messageFrom = {
          id: hashCode(quoteMessage.forward_sender_name),
          name: quoteMessage.forward_sender_name,
          username: 'HiddenSender'
        }
      }
    } else if (quoteMessage.forward_from_chat) {
      messageFrom = {
        id: quoteMessage.forward_from_chat.id,
        name: quoteMessage.forward_from_chat.title,
        username: quoteMessage.forward_from_chat.username || null,
        photo: quoteMessage.forward_from_chat.photo
      }
    } else if (quoteMessage.forward_from) {
      messageFrom = quoteMessage.forward_from
    } else if ([1087968824, 777000].includes(quoteMessage.from.id)) {
      /* 1087968824 is id of @GroupAnonymousBot. This part swaps anon bot data to the chat data */
      messageFrom = {
        id: quoteMessage.sender_chat.id,
        name: quoteMessage.sender_chat.title,
        username: quoteMessage.sender_chat.username || null,
        photo: quoteMessage.sender_chat.photo
      }
    } else {
      messageFrom = quoteMessage.from
    }

    if (messageFrom.title) messageFrom.name = messageFrom.title
    if (messageFrom.first_name) messageFrom.name = messageFrom.first_name
    if (messageFrom.last_name) messageFrom.name += ' ' + messageFrom.last_name

    quoteMessage.from = messageFrom

    let diffUser = true
    if (lastMessage && (quoteMessage.from.id === lastMessage.from.id)) diffUser = false

    const message = {}

    let text

    if (quoteMessage.caption) {
      text = quoteMessage.caption
      message.entities = quoteMessage.caption_entities
    } else {
      text = quoteMessage.text
      message.entities = quoteMessage.entities
    }

    if (!text) {
      flag.media = true
      message.mediaCrop = flag.crop || false
    }
    if (flag.media && quoteMessage.photo) message.media = quoteMessage.photo
    if (flag.media && quoteMessage.sticker) {
      message.media = [quoteMessage.sticker]
      if (quoteMessage.sticker.is_video) {
        message.media = [quoteMessage.sticker.thumb]
      }
      message.mediaType = 'sticker'
    }
    if (flag.media && (quoteMessage.animation || quoteMessage.video)) {
      const { thumbnail } = quoteMessage.animation || quoteMessage.video
      message.media = [thumbnail]
    }
    if (flag.media && quoteMessage.voice) {
      message.voice = quoteMessage.voice
    }

    if (messageFrom.id) {
      message.chatId = messageFrom.id
    } else {
      message.chatId = hashCode(quoteMessage.from.name)
    }

    let avatarImage = true
    if (!diffUser || (ctx.me === quoteMessage.from.username && index > 0)) {
      avatarImage = false
      quoteMessage.from.name = false
    }

    if (avatarImage) message.avatar = avatarImage
    if (messageFrom) message.from = messageFrom
    if (text) message.text = text

    if (!flag.privacy && message.from) {
      if (ctx.group && ctx.group.info.settings.privacy && !ctx.chat.username) {
        flag.privacy = true
      } else {
        const quotedFind = await ctx.db.User.findOne({ telegram_id: message.from.id })
        if (quotedFind && quotedFind.settings.privacy) flag.privacy = true
      }
    }

    message.replyMessage = {}
    if (flag.reply && quoteMessage.reply_to_message) {
      const replyMessageInfo = quoteMessage.reply_to_message
      if (replyMessageInfo.forward_from) {
        replyMessageInfo.from = replyMessageInfo.forward_from
      }
      if (replyMessageInfo.from.first_name) message.replyMessage.name = replyMessageInfo.from.first_name
      if (replyMessageInfo.from.last_name) message.replyMessage.name += ' ' + replyMessageInfo.from.last_name
      if (replyMessageInfo.from.id) {
        message.replyMessage.chatId = replyMessageInfo.from.id
      } else {
        message.replyMessage.chatId = hashCode(message.replyMessage.name)
      }
      if (replyMessageInfo.text) message.replyMessage.text = replyMessageInfo.text
      if (replyMessageInfo.caption) message.replyMessage.text = replyMessageInfo.caption
      if (replyMessageInfo.entities) message.replyMessage.entities = replyMessageInfo.entities
    }

    if (!message.text && !message.media) {
      message.text = ctx.i18n.t('quote.unsupported_message')
      message.entities = [{
        offset: 0,
        length: message.text.length,
        type: 'italic'
      }]
    }

    quoteMessages[index] = message

    lastMessage = quoteMessage
  }

  if (quoteMessages.length < 1) {
    return ctx.replyWithHTML(ctx.i18n.t('quote.empty_forward'), {
      reply_to_message_id: ctx.message.message_id,
      allow_sending_without_reply: true
    })
  }

  let width = 512
  let height = 512 * 1.5
  let scale = 2

  if (flag.png || flag.img) {
    width *= 1.5
    height *= 5
    scale *= 1.5
  }

  let type = 'quote'

  if (flag.img) type = 'image'
  if (flag.png) type = 'png'

  let format
  if (!flag.privacy && type === 'quote') format = 'png'

  console.log(`Request generate quote for chat_id=${ctx.chat.id}; msg=${ctx.message.message_id}; c=${messageCount}`)

  const generate = await got.post(`${process.env.QUOTE_API_URI}/generate.png?botToken=${process.env.BOT_TOKEN}`, {
    json: {
      type,
      format,
      backgroundColor,
      width,
      height,
      scale: flag.scale || scale,
      messages: quoteMessages,
      emojiBrand
    },
    responseType: 'buffer',
    timeout: 1000 * 30,
    retry: 1
  }).catch((error) => {
    return { error }
  })

  if (generate.error) {
    if (generate.error.response && generate.error.response.body) {
      // const errorMessage = JSON.parse(generate.error.response.body).error.message

      return ctx.replyWithHTML(ctx.i18n.t('quote.api_error', {
        error: 'internal_error'
      }), {
        reply_to_message_id: ctx.message.message_id,
        allow_sending_without_reply: true
      })
    } else {
      console.error(generate.error)
      return ctx.replyWithHTML(ctx.i18n.t('quote.api_error', {
        error: 'quote_api_down'
      }), {
        reply_to_message_id: ctx.message.message_id,
        allow_sending_without_reply: true
      })
    }
  }

  let emojis = ctx.group ? ctx.group.info.settings.quote.emojiSuffix : ctx.session.userInfo.settings.quote.emojiSuffix
  if (!emojis || emojis === 'random') emojis = emojiArray[Math.floor(Math.random() * emojiArray.length)].emoji

  emojis = `${emojis}💜`

  if (generate.body) {
    const image = generate.body
    if (generate.headers['quote-type'] === 'quote') {
      let replyMarkup = {}

      if (ctx.group && (ctx.group.info.settings.rate || flag.rate)) {
        replyMarkup = Markup.inlineKeyboard([
          Markup.callbackButton('👍', 'rate:👍'),
          Markup.callbackButton('👎', 'rate:👎')
        ])
      }

      let sendResult

      if (flag.privacy) {
        sendResult = await ctx.replyWithDocument({
          source: image,
          filename: 'quote.webp'
        }, {
          reply_to_message_id: ctx.message.message_id,
          allow_sending_without_reply: true,
          reply_markup: replyMarkup
        })
      } else {
        if (!ctx.session.userInfo.tempStickerSet.create) {
          const getMe = await telegram.getMe()

          const packName = `temp_${Math.random().toString(36).substring(5)}_${Math.abs(ctx.from.id)}_by_${getMe.username}`
          const packTitle = `Created by @${getMe.username}`

          const created = await telegram.createNewStickerSet(ctx.from.id, packName, packTitle, {
            png_sticker: { source: 'placeholder.png' },
            emojis
          }).catch(console.error)

          ctx.session.userInfo.tempStickerSet.name = packName
          ctx.session.userInfo.tempStickerSet.create = created
        }

        let packOwnerId = config.globalStickerSet.ownerId
        let packName = config.globalStickerSet.name + ctx.me

        if (ctx.session.userInfo.tempStickerSet.create) {
          packOwnerId = ctx.from.id
          packName = ctx.session.userInfo.tempStickerSet.name
        }

        const addSticker = await ctx.telegram.addStickerToSet(packOwnerId, packName, {
          png_sticker: { source: image },
          emojis
        }, true).catch((error) => {
          console.error(error)
          if (error.description === 'Bad Request: STICKERSET_INVALID') {
            ctx.session.userInfo.tempStickerSet.create = false
          }
        })

        if (addSticker) {
          const sticketSet = await ctx.getStickerSet(packName)

          if (ctx.session.userInfo.tempStickerSet.create) {
            for (const i in sticketSet.stickers) {
              const sticker = sticketSet.stickers[i]
              if (i > config.globalStickerSet.save_sticker_count - 1) {
                telegram.deleteStickerFromSet(sticker.file_id).catch(console.error)
              }
            }
          }

          sendResult = await ctx.replyWithDocument(sticketSet.stickers[sticketSet.stickers.length - 1].file_id, {
            reply_to_message_id: ctx.message.message_id,
            allow_sending_without_reply: true,
            reply_markup: replyMarkup
          })
        }
      }

      if (sendResult && ctx.group && (ctx.group.info.settings.rate || flag.rate)) {
        const quoteDb = new ctx.db.Quote()
        quoteDb.group = ctx.group.info
        quoteDb.user = ctx.session.userInfo
        quoteDb.file_id = sendResult.sticker.file_id
        quoteDb.file_unique_id = sendResult.sticker.file_unique_id
        quoteDb.rate = {
          votes: [
            {
              name: '👍',
              vote: []
            },
            {
              name: '👎',
              vote: []
            }
          ],
          score: 0
        }

        await quoteDb.save()
      }
    } else if (generate.headers['quote-type'] === 'image') {
      await ctx.replyWithPhoto({
        source: image,
        filename: 'quote.png'
      }, {
        reply_to_message_id: ctx.message.message_id,
        allow_sending_without_reply: true
      })
    } else {
      await ctx.replyWithDocument({
        source: image,
        filename: 'quote.png'
      }, {
        reply_to_message_id: ctx.message.message_id,
        allow_sending_without_reply: true
      })
    }
  }
}
