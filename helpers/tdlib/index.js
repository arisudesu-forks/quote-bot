const path = require('path')

const tdDirectory = path.resolve(__dirname, 'data')

const { Client } = require('tdl')
const { TDLib } = require('tdl-tdlib-addon')

let tdLibFile = process.platform === 'win32' ? 'tdjson.dll' : 'libtdjson.so'
if (process.platform === 'darwin') tdLibFile = 'libtdjson.dylib'

const client = new Client(new TDLib(`${tdDirectory}/${tdLibFile}`), {
  apiId: process.env.TELEGRAM_API_ID || 2834,
  apiHash: process.env.TELEGRAM_API_HASH || '68875f756c9b437a8b916ca3de215815',
  databaseDirectory: `${tdDirectory}/db`,
  filesDirectory: tdDirectory,
  verbosityLevel: 0,
  tdlibParameters: {
    use_message_database: false,
    use_chat_info_database: false,
    use_file_database: false
  }
})

client.on('error', console.error)

async function main () {
  await client.connectAndLogin(() => ({
    type: 'bot',
    getToken: retry => retry
      ? Promise.reject('Token is not valid')
      : Promise.resolve(process.env.BOT_TOKEN)
  }))

  await client.invoke({ _: 'setOption', name: 'ignore_inline_thumbnails', value: { _: 'optionValueBoolean', value: true } }).catch(console.error)
  await client.invoke({ _: 'setOption', name: 'reuse_uploaded_photos_by_hash', value: { _: 'optionValueBoolean', value: true } }).catch(console.error)
  await client.invoke({ _: 'setOption', name: 'disable_persistent_network_statistics', value: { _: 'optionValueBoolean', value: true } }).catch(console.error)
  await client.invoke({ _: 'setOption', name: 'disable_time_adjustment_protection', value: { _: 'optionValueBoolean', value: true } }).catch(console.error)
}

main()

function sendMethod (method, parm) {
  return new Promise((resolve, reject) => {
    client.invoke(Object.assign({ _: method }, parm)).then(resolve).catch(resolve)
  })
}

function getUser (userID) {
  return new Promise((resolve, reject) => {
    sendMethod('getUser', {
      user_id: userID
    }).then((response) => {
      if (response._ === 'error') reject(new Error(`[TDLib][${response.code}] ${response.message}`))
      const user = {
        id: response.id,
        first_name: response.first_name,
        last_name: response.last_name,
        username: response.username,
        language_code: response.language_code
      }

      return resolve(user)
    }).catch((console.error))
  })
}

function getSupergroup (supergroupID) {
  return new Promise((resolve, reject) => {
    sendMethod('getSupergroup', {
      supergroup_id: supergroupID
    }).then((response) => {
      if (response._ === 'error') reject(new Error(`[TDLib][${response.code}] ${response.message}`))
      const supergroup = {
        username: response.username
      }

      resolve(supergroup)
    })
  })
}

function getChat (chatID) {
  return new Promise((resolve, reject) => {
    sendMethod('getChat', {
      chat_id: chatID
    }).then((response) => {
      if (response._ === 'error') reject(new Error(`[TDLib][${response.code}] ${response.message}`))

      const chat = {
        id: response.id,
        title: response.title
      }

      if (response.photo) {
        chat.photo = {
          small_file_id: response.photo.small.remote.id,
          small_file_unique_id: response.photo.small.remote.unique_id,
          big_file_id: response.photo.big.remote.id,
          big_file_unique_id: response.photo.big.remote.unique_id
        }
      }

      const chatTypeMap = {
        chatTypePrivate: 'private',
        chatTypeBasicGroup: 'group',
        chatTypeSupergroup: 'supergroup',
        chatTypeSecret: 'secret'
      }

      chat.type = chatTypeMap[response.type._]

      if (['private', 'secret'].includes(chat.type)) {
        getUser(chat.id).then((user) => {
          resolve(Object.assign(user, chat))
        })
      } else {
        chat.title = response.title

        if (response.type.is_channel && response.type.is_channel === true) chat.type = 'channel'

        if (response.type.supergroup_id) {
          getSupergroup(response.type.supergroup_id).then((supergroup) => {
            resolve(Object.assign(supergroup, chat))
          })
        } else {
          resolve(chat)
        }
      }
    })
  })
}

function decodeWaveform (wf) {
  const bitsCount = wf.length * 8
  const valuesCount = ~~(bitsCount / 5)

  if (!valuesCount) return []

  const lastIdx = valuesCount - 1

  const result = []
  for (let i = 0, j = 0; i < lastIdx; i++, j += 5) {
    const byteIdx = ~~(j / 8)
    const bitShift = j % 8
    result[i] = (wf.readUInt16LE(byteIdx) >> bitShift) & 0b11111
  }

  const lastByteIdx = ~~((lastIdx * 5) / 8)
  const lastBitShift = (lastIdx * 5) % 8
  const lastValue =
      lastByteIdx === wf.length - 1
        ? wf[lastByteIdx]
        : wf.readUInt16LE(lastByteIdx)
  result[lastIdx] = (lastValue >> lastBitShift) & 0b11111

  return result
}

function getMessages (chatID, messageIds) {
  const tdlibMessageIds = messageIds.map((id) => id * Math.pow(2, 20))

  return new Promise((resolve, reject) => {
    sendMethod('getMessages', {
      chat_id: chatID,
      message_ids: tdlibMessageIds
    }).then((response) => {
      if (response._ === 'error') reject(new Error(`[TDLib][${response.code}] ${response.message}`))

      const messages = response.messages.map((messageInfo) => {
        if (!messageInfo) return {}
        return new Promise((resolve, reject) => {
          const message = {
            message_id: messageInfo.id / Math.pow(2, 20),
            date: messageInfo.date
          }
          const messagePromise = []
          const replyToMessageID = messageInfo.reply_to_message_id / Math.pow(2, 20)

          if (messageInfo.reply_to_message_id) messagePromise.push(getMessages(chatID, [replyToMessageID]))
          Promise.all(messagePromise).then((replyMessage) => {
            if (replyMessage && replyMessage[0] && replyMessage[0][0] && Object.keys(replyMessage[0][0]).length !== 0) message.reply_to_message = replyMessage[0][0]

            const chatIds = [
              messageInfo.chat_id
            ]

            if (messageInfo.sender_id.user_id) chatIds.push(messageInfo.sender_id.user_id)
            if (messageInfo.sender_id.chat_id) chatIds.push(messageInfo.sender_id.chat_id)

            let forwarderId

            if (messageInfo.forward_info && messageInfo.forward_info.origin.sender_user_id) forwarderId = messageInfo.forward_info.origin.sender_user_id
            if (messageInfo.forward_info && messageInfo.forward_info.origin.sender_chat_id) forwarderId = messageInfo.forward_info.origin.sender_chat_id
            if (messageInfo.forward_info && messageInfo.forward_info.origin.user_id) forwarderId = messageInfo.forward_info.origin.user_id
            if (messageInfo.forward_info && messageInfo.forward_info.origin.chat_id) forwarderId = messageInfo.forward_info.origin.chat_id

            if (forwarderId) chatIds.push(forwarderId)

            const chatInfoPromise = chatIds.map(getChat)

            Promise.all(chatInfoPromise).then((chats) => {
              const chatInfo = {}
              chats.map((chat) => {
                chatInfo[chat.id] = chat
              })

              message.chat = chatInfo[messageInfo.chat_id]
              if (messageInfo.sender_id.user_id) message.from = chatInfo[messageInfo.sender_id.user_id]
              else if (messageInfo.sender_id.chat_id) message.from = chatInfo[messageInfo.sender_id.chat_id]

              if (messageInfo.forward_info) {
                if (chatInfo[forwarderId]) {
                  if (!chatInfo[forwarderId].type) {
                    message.forward_from = chatInfo[forwarderId]
                  } else {
                    message.forward_from_chat = chatInfo[forwarderId]
                  }
                }
                if (messageInfo.forward_info.origin.sender_name) message.forward_sender_name = messageInfo.forward_info.origin.sender_name
              }

              let entities

              if (messageInfo.content.text) {
                message.text = messageInfo.content.text.text
                entities = messageInfo.content.text.entities
              }
              if (messageInfo.content) {
                const mediaType = {
                  messagePhoto: 'photo',
                  messageSticker: 'sticker',
                  messageVoiceNote: 'voice',
                  messageVideo: 'video',
                  messageAnimation: 'animation'
                }

                const type = mediaType[messageInfo.content._]

                if (type) {
                  let media
                  if (messageInfo.content.voice_note) {
                    const { voice_note } = messageInfo.content
                    const waveform = decodeWaveform(Buffer.from(voice_note.waveform, 'base64'))

                    media = {
                      file_id: voice_note.voice.remote.id,
                      waveform
                    }
                  } else if (messageInfo.content[type].sizes) {
                    media = messageInfo.content[type].sizes.map((size) => {
                      return {
                        file_id: size[type].remote.id,
                        file_unique_id: size[type].remote.unique_id,
                        file_size: size[type].size,
                        height: size.height,
                        width: size.width
                      }
                    })
                  } else if (['video', 'animation'].includes(type) && messageInfo.content[type].thumbnail) {
                    const { file } = messageInfo.content[type].thumbnail
                    media = {
                      thumbnail: {
                        file_id: file.remote.id,
                        file_unique_id: file.remote.unique_id,
                        file_size: file.size
                      }
                    }
                  } else if (['sticker'].includes(type)) {
                    const sticker = messageInfo.content[type]
                    media = {
                      file_id: sticker.sticker.remote.id,
                      is_animated: sticker.type._ === 'stickerTypeAnimated',
                      is_video: sticker.type._ === 'stickerTypeVideo',
                      thumb: {
                        file_id: sticker.thumbnail.file.remote.id
                      }
                    }
                  } else {
                    media = {
                      file_id: messageInfo.content[type][type].remote.id,
                      file_unique_id: messageInfo.content[type][type].remote.unique_id,
                      file_size: messageInfo.content[type][type].size,
                      height: messageInfo.content[type].height,
                      width: messageInfo.content[type].width
                    }
                  }

                  message[type] = media
                } else {
                  message.unsupportedMessage = true
                }

                if (messageInfo.content.caption) {
                  message.caption = messageInfo.content.caption.text
                  if (messageInfo.content.caption.entities) entities = messageInfo.content.caption.entities
                }
              }

              if (entities) {
                const entitiesFormat = entities.map((entityInfo) => {
                  const typeMap = {
                    textEntityTypeMention: 'mention',
                    textEntityTypeHashtag: 'hashtag',
                    textEntityTypeCashtag: 'cashtag',
                    textEntityTypeBotCommand: 'bot_command',
                    textEntityTypeUrl: 'url',
                    textEntityTypeEmailAddress: 'email',
                    textEntityTypeBold: 'bold',
                    textEntityTypeItalic: 'italic',
                    textEntityTypeUnderline: 'underline',
                    textEntityTypeStrikethrough: 'strikethrough',
                    textEntityTypeCode: 'code',
                    textEntityTypePre: 'pre',
                    textEntityTypePreCode: 'pre_code',
                    textEntityTypeTextUrl: 'text_link',
                    textEntityTypeMentionName: 'text_mention',
                    textEntityTypePhoneNumber: 'phone_number',
                    textEntityTypeSpoiler: 'spoiler'
                  }

                  const entity = {
                    length: entityInfo.length,
                    offset: entityInfo.offset,
                    type: typeMap[entityInfo.type._]
                  }

                  if (entity.type === 'text_link') entity.url = entityInfo.type.url
                  if (entity.type === 'text_mention') entity.user = entityInfo.type.user_id

                  return entity
                })

                if (message.caption) {
                  message.caption_entities = entitiesFormat
                } else {
                  message.entities = entitiesFormat
                }
              }

              resolve(message)
            })
          })
        })
      })

      Promise.all(messages).then(resolve)
    }).catch((error) => {
      console.error(error)
      reject(error)
    })
  })
}

module.exports = {
  getMessages
}
