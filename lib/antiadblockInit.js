/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2015 Eyeo GmbH
 *
 * Adblock Plus is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Adblock Plus is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Adblock Plus.  If not, see <http://www.gnu.org/licenses/>.
 */

Cu.import("resource://gre/modules/Services.jsm");

let {Utils} = require("utils");
let {Prefs} = require("prefs");
let {ActiveFilter} = require("filterClasses");
let {FilterStorage} = require("filterStorage");
let {FilterNotifier} = require("filterNotifier");
let {Subscription} = require("subscriptionClasses");
let {Notification} = require("notification");

exports.initAntiAdblockNotification = function initAntiAdblockNotification()
{
  let notification = {
    id: "antiadblock",
    type: "question",
    title: Utils.getString("notification_antiadblock_title"),
    message: Utils.getString("notification_antiadblock_message"),
    urlFilters: []
  };

  function notificationListener(approved)
  {
    let subscription = Subscription.fromURL(Prefs.subscriptions_antiadblockurl);
    if (subscription.url in FilterStorage.knownSubscriptions)
      subscription.disabled = !approved;
  }

  function addAntiAdblockNotification(subscription)
  {
    let urlFilters = [];
    for (let filter of subscription.filters)
    {
      if (filter instanceof ActiveFilter)
      {
        for (let domain in filter.domains)
        {
          let urlFilter = "||" + domain + "^";
          if (domain && filter.domains[domain] && urlFilters.indexOf(urlFilter) == -1)
            urlFilters.push(urlFilter);
        }
      }
    }
    notification.urlFilters = urlFilters;
    Notification.addNotification(notification);
    Notification.addQuestionListener(notification.id, notificationListener);
  }

  function removeAntiAdblockNotification()
  {
    Notification.removeNotification(notification);
    Notification.removeQuestionListener(notification.id, notificationListener);
  }

  let subscription = Subscription.fromURL(Prefs.subscriptions_antiadblockurl);
  if (subscription.lastDownload && subscription.disabled)
    addAntiAdblockNotification(subscription);

  FilterNotifier.addListener(function(action, value, newItem, oldItem)
  {
    if (!/^subscription\.(updated|removed|disabled)$/.test(action) || value.url != Prefs.subscriptions_antiadblockurl)
      return;

    if (action == "subscription.updated")
      addAntiAdblockNotification(value);
    else if (action == "subscription.removed" || (action == "subscription.disabled" && !value.disabled))
      removeAntiAdblockNotification();
  });
}
