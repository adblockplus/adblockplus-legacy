/*
 * This file is part of Adblock Plus <http://adblockplus.org/>,
 * Copyright (C) 2006-2013 Eyeo GmbH
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

/**
 * @fileOverview Handles notifications.
 */

Cu.import("resource://gre/modules/Services.jsm");

let {Prefs} = require("prefs");

function compareSeverity(notification1, notification2)
{
  let levels = {information: 0, critical: 1};
  return levels[notification1.severity] - levels[notification2.severity];
}

/**
 * Regularly fetches notifications and decides which to show.
 * @class
 */
let Notification = exports.Notification =
{
  /**
   * Determines which notification is to be shown next.
   * @param {Array of Object} notifications active notifications
   * @return {Object} notification to be shown, or null if there is none
   */
  getNextToShow: function(notifications)
  {
    if (!Prefs.shownNotifications)
      Prefs.shownNotifications = [];

    let notificationToShow;
    for each (let notification in notifications)
    {
      if (notification.severity === "information"
          && Prefs.shownNotifications.indexOf(notification.timestamp) !== -1)
        continue;

      let info = require("info");
      let platform = info.application;
      let version = info.addonVersion;

      if ("platforms" in notification
          && notification.platforms.indexOf("chrome") === -1)
        continue;

      if ("minVersion" in notification
          && Services.vc.compare(version, notification.minVersion) < 0)
        continue;

      if ("maxVersion" in notification
          && Services.vc.compare(version, notification.maxVersion) > 0)
        continue;

      if (!notificationToShow
          || compareSeverity(notification, notificationToShow) > 0)
        notificationToShow = notification;
    }

    if (notificationToShow && "timestamp" in notificationToShow)
      Prefs.shownNotifications.push(notificationToShow.timestamp);

    return notificationToShow;
  }
};
