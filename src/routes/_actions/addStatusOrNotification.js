import { mark, stop } from '../_utils/marks'
import { store } from '../_store/store'
import uniqBy from 'lodash-es/uniqBy'
import uniq from 'lodash-es/uniq'
import isEqual from 'lodash-es/isEqual'
import { database } from '../_database/database'
import { concat } from '../_utils/arrays'
import { scheduleIdleTask } from '../_utils/scheduleIdleTask'

function getExistingItemIdsSet (instanceName, timelineName) {
  let timelineItemIds = store.getForTimeline(instanceName, timelineName, 'timelineItemIds') || []
  return new Set(timelineItemIds)
}

function removeDuplicates (instanceName, timelineName, updates) {
  // remove duplicates, including duplicates due to reblogs
  let existingItemIds = getExistingItemIdsSet(instanceName, timelineName)
  return updates.filter(update => !existingItemIds.has(update.id))
}

async function insertUpdatesIntoTimeline (instanceName, timelineName, updates) {
  updates = removeDuplicates(instanceName, timelineName, updates)

  if (!updates.length) {
    return
  }

  await database.insertTimelineItems(instanceName, timelineName, updates)

  let itemIdsToAdd = store.getForTimeline(instanceName, timelineName, 'itemIdsToAdd') || []
  let newItemIdsToAdd = uniq(concat(itemIdsToAdd, updates.map(_ => _.id)))
  if (!isEqual(itemIdsToAdd, newItemIdsToAdd)) {
    console.log('adding ', (newItemIdsToAdd.length - itemIdsToAdd.length),
      'items to itemIdsToAdd for timeline', timelineName)
    store.setForTimeline(instanceName, timelineName, { itemIdsToAdd: newItemIdsToAdd })
  }
}

async function insertUpdatesIntoThreads (instanceName, updates) {
  if (!updates.length) {
    return
  }

  let threads = store.getThreads(instanceName)

  for (let timelineName of Object.keys(threads)) {
    let thread = threads[timelineName]
    let itemIdsToAdd = store.getForTimeline(instanceName, timelineName, 'itemIdsToAdd') || []
    let updatesForThisThread = updates.filter(status => (
      thread.includes(status.in_reply_to_id) &&
      !thread.includes(status.id) &&
      !itemIdsToAdd.includes(status.id)
    ))
    if (!updatesForThisThread.length) {
      continue
    }
    let newItemIdsToAdd = uniq(concat(itemIdsToAdd, updatesForThisThread.map(_ => _.id)))
    if (!isEqual(itemIdsToAdd, newItemIdsToAdd)) {
      console.log('adding ', (newItemIdsToAdd.length - itemIdsToAdd.length),
        'items to itemIdsToAdd for thread', timelineName)
      store.setForTimeline(instanceName, timelineName, { itemIdsToAdd: newItemIdsToAdd })
    }
  }
}

async function processFreshUpdates (instanceName, timelineName) {
  mark('processFreshUpdates')
  let freshUpdates = store.getForTimeline(instanceName, timelineName, 'freshUpdates')
  if (freshUpdates && freshUpdates.length) {
    let updates = freshUpdates.slice()
    store.setForTimeline(instanceName, timelineName, { freshUpdates: [] })

    await Promise.all([
      insertUpdatesIntoTimeline(instanceName, timelineName, updates),
      insertUpdatesIntoThreads(instanceName, updates.filter(status => status.in_reply_to_id))
    ])
  }
  stop('processFreshUpdates')
}

function lazilyProcessFreshUpdates (instanceName, timelineName) {
  scheduleIdleTask(() => {
    /* no await */ processFreshUpdates(instanceName, timelineName)
  })
}

export function addStatusOrNotification (instanceName, timelineName, newStatusOrNotification) {
  addStatusesOrNotifications(instanceName, timelineName, [newStatusOrNotification])
}

export function addStatusesOrNotifications (instanceName, timelineName, newStatusesOrNotifications) {
  console.log('addStatusesOrNotifications', Date.now())
  let freshUpdates = store.getForTimeline(instanceName, timelineName, 'freshUpdates') || []
  freshUpdates = concat(freshUpdates, newStatusesOrNotifications)
  freshUpdates = uniqBy(freshUpdates, _ => _.id)
  store.setForTimeline(instanceName, timelineName, { freshUpdates: freshUpdates })
  lazilyProcessFreshUpdates(instanceName, timelineName)
}
