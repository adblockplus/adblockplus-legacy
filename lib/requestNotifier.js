/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2016 Eyeo GmbH
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
 * @fileOverview Stores Adblock Plus data to be attached to a window.
 */

let {port} = require("messaging");

let requestNotifierMaxId = 0;

/**
 * Active RequestNotifier instances by their ID
 * @type Map.<number,RequestNotifier>
 */
let notifiers = new Map();

port.on("foundNodeData", ({notifierID, data}, sender) =>
{
  let notifier = notifiers.get(notifierID);
  if (notifier)
    notifier.notifyListener(data);
});

port.on("scanComplete", (notifierID, sender) =>
{
  let notifier = notifiers.get(notifierID);
  if (notifier)
    notifier.onComplete();
});

/**
 * Creates a notifier object for a particular window. After creation the window
 * will first be scanned for previously saved requests. Once that scan is
 * complete only new requests for this window will be reported.
 * @param {Integer} outerWindowID  ID of the window to attach the notifier to
 * @param {Function} listener  listener to be called whenever a new request is found
 * @param {Object} [listenerObj]  "this" pointer to be used when calling the listener
 */
function RequestNotifier(outerWindowID, listener, listenerObj)
{
  this.listener = listener;
  this.listenerObj = listenerObj || null;
  this.id = ++requestNotifierMaxId;
  notifiers.set(this.id, this);

  port.emit("startWindowScan", {
    notifierID: this.id,
    outerWindowID: outerWindowID
  });
}
exports.RequestNotifier = RequestNotifier;

RequestNotifier.prototype =
{
  /**
   * The unique ID of this notifier.
   * @type Integer
   */
  id: null,

  /**
   * The listener to be called when a new request is found.
   * @type Function
   */
  listener: null,

  /**
   * "this" pointer to be used when calling the listener.
   * @type Object
   */
  listenerObj: null,

  /**
   * Will be set to true once the initial window scan is complete.
   * @type Boolean
   */
  scanComplete: false,

  /**
   * Shuts down the notifier once it is no longer used. The listener
   * will no longer be called after that.
   */
  shutdown: function()
  {
    notifiers.delete(this.id);
    port.emit("shutdownNotifier", this.id);
  },

  /**
   * Notifies listener about a new request.
   * @param {Object} entry
   */
  notifyListener: function(entry)
  {
    this.listener.call(this.listenerObj, entry, this.scanComplete);
  },

  onComplete: function()
  {
    this.scanComplete = true;
    this.notifyListener(null);
  },

  /**
   * Makes the nodes associated with the given requests blink.
   * @param {number[]} requests  list of request IDs that were previously
   *                             reported by this notifier.
   * @param {Boolean} scrollToItem  if true, scroll to first node
   */
  flashNodes: function(requests, scrollToItem)
  {
    if (!requests)
      requests = [];

    port.emit("flashNodes", {
      notifierID: this.id,
      requests,
      scrollToItem
    });
  },

  /**
   * Attempts to calculate the size of the nodes associated with the requests.
   * @param {number[]} requests  list of request IDs that were previously
   *                             reported by this notifier.
   * @param {Function} callback  function to be called with two parameters (x,y)
   */
  retrieveNodeSize: function(requests, callback)
  {
    if (!requests)
      requests = [];

    port.emitWithResponse("retrieveNodeSize", {
      notifierID: this.id,
      requests
    }).then(callback);
  },

  /**
   * Stores the nodes associated with the requests and generates a unique ID
   * for them that can be used with Policy.refilterNodes(). Note that
   * Policy.deleteNodes() always has to be called to release the memory.
   * @param {number[]} requests  list of request IDs that were previously
   *                             reported by this notifier.
   * @param {Function} callback  function to be called with the nodes ID.
   */
  storeNodesForEntries: function(requests, callback)
  {
    if (!requests)
      requests = [];

    port.emitWithResponse("storeNodesForEntries", {
      notifierID: this.id,
      requests
    }).then(callback);
  }
};

/**
 * Associates a piece of data with a particular window.
 * @param {number} outerWindowID  the ID of the window
 * @static
 */
RequestNotifier.storeWindowData = function(outerWindowID, data)
{
  port.emit("storeWindowData", {
    outerWindowID,
    data
  });
};

/**
 * Retrieves a piece of data previously associated with the window by calling
 * storeWindowData.
 * @param {number} outerWindowID  the ID of the window
 * @param {Function} callback  function to be called with the data.
 * @static
 */
RequestNotifier.retrieveWindowData = function(outerWindowID, callback)
{
  port.emitWithResponse("retrieveWindowData", outerWindowID).then(callback);
};

/**
 * Retrieves the statistics for a window.
 * @param {number} outerWindowID  the ID of the window
 * @param {Function} callback  the callback to be called with the resulting
 *                             object (object properties will be items, blocked,
 *                             whitelisted, hidden, filters) or null.
 */
RequestNotifier.getWindowStatistics = function(outerWindowID, callback)
{
  port.emitWithResponse("retrieveWindowStats", outerWindowID).then(callback);
};
