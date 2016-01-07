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

/**
 * @fileOverview Collects some data for a content window, to be attached to
 * issue reports.
 */

"use strict";

let {Utils} = require("utils");

let maxResponseID = 0;
let callbacks = new Map();

let messageManager = Cc["@mozilla.org/parentprocessmessagemanager;1"]
                       .getService(Ci.nsIMessageListenerManager)
                       .QueryInterface(Ci.nsIMessageBroadcaster);

Utils.addChildMessageListener("AdblockPlus:CollectDataResponse", onResponse);

function onResponse({responseID, data})
{
  let callback = callbacks.get(responseID);
  callbacks.delete(responseID);
  if (typeof callback == "function")
    callback(data);
}

/**
 * Collects data for the given window.
 * @param {number} outerWindowID  the ID of the window
 * @param {number} screenshotWidth  width of the screenshot to be created
 * @param {Function} callback  function to be called with the data
 */
function collectData(outerWindowID, screenshotWidth, callback)
{
  let id = ++maxResponseID;
  callbacks.set(id, callback);

  messageManager.broadcastAsyncMessage("AdblockPlus:CollectData", {
    outerWindowID,
    screenshotWidth,
    responseID: id
  });
}
exports.collectData = collectData;
