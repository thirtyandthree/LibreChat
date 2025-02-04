const { MeiliSearch } = require('meilisearch');
const Message = require('~/models/schema/messageSchema');
const Conversation = require('~/models/schema/convoSchema');
const { logger } = require('~/config');

const searchEnabled = process.env?.SEARCH?.toLowerCase() === 'true';
let currentTimeout = null;

// eslint-disable-next-line no-unused-vars
async function indexSync(req, res, next) {
  if (!searchEnabled) {
    return;
  }

  try {
    if (!process.env.MEILI_HOST || !process.env.MEILI_MASTER_KEY || !searchEnabled) {
      throw new Error('Meilisearch not configured, search will be disabled.');
    }

    const client = new MeiliSearch({
      host: process.env.MEILI_HOST,
      apiKey: process.env.MEILI_MASTER_KEY,
    });

    const { status } = await client.health();
    // logger.debug(`[indexSync] Meilisearch: ${status}`);
    const result = status === 'available' && !!process.env.SEARCH;

    if (!result) {
      throw new Error('Meilisearch not available');
    }

    const messageCount = await Message.countDocuments();
    const convoCount = await Conversation.countDocuments();
    const messages = await client.index('messages').getStats();
    const convos = await client.index('convos').getStats();
    const messagesIndexed = messages.numberOfDocuments;
    const convosIndexed = convos.numberOfDocuments;

    logger.debug(
      `[indexSync] There are ${messageCount} messages in the database, ${messagesIndexed} indexed`,
    );
    logger.debug(
      `[indexSync] There are ${convoCount} convos in the database, ${convosIndexed} indexed`,
    );

    if (messageCount !== messagesIndexed) {
      logger.debug('[indexSync] Messages out of sync, indexing');
      Message.syncWithMeili();
    }

    if (convoCount !== convosIndexed) {
      logger.debug('[indexSync] Convos out of sync, indexing');
      Conversation.syncWithMeili();
    }
  } catch (err) {
    // logger.debug('[indexSync] in index sync');
    if (err.message.includes('not found')) {
      logger.debug('[indexSync] Creating indices...');
      currentTimeout = setTimeout(async () => {
        try {
          await Message.syncWithMeili();
          await Conversation.syncWithMeili();
        } catch (err) {
          logger.error('[indexSync] Trouble creating indices, try restarting the server.', err);
        }
      }, 750);
    } else {
      logger.error('[indexSync] error', err);
      // res.status(500).json({ error: 'Server error' });
    }
  }
}

process.on('exit', () => {
  logger.debug('[indexSync] Clearing sync timeouts before exiting...');
  clearTimeout(currentTimeout);
});

module.exports = indexSync;
