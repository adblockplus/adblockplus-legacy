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
 * @fileOverview Stores Adblock Plus data to be attached to a window.
 */
let {Services} = Cu.import("resource://gre/modules/Services.jsm", {});

let {Utils} = require("utils");

let nodeData = new WeakMap();
let windowStats = new WeakMap();
let requestEntryMaxId = 0;

/**
 * Active RequestNotifier instances by their ID
 * @type Map.<number,RequestNotifier>
 */
let notifiers = new Map();

addMessageListener("AdblockPlus:StartWindowScan", onStartScan);
addMessageListener("AdblockPlus:ShutdownNotifier", onNotifierShutdown);

onShutdown.add(() => {
  removeMessageListener("AdblockPlus:StartWindowScan", onStartScan);
  removeMessageListener("AdblockPlus:ShutdownNotifier", onNotifierShutdown);
});

function onStartScan(message)
{
  let {notifierID, outerWindowID} = message.data;
  let window = Services.wm.getOuterWindowWithId(outerWindowID);
  if (window)
    new RequestNotifier(window, notifierID);
}

function onNotifierShutdown(message)
{
  let notifier = notifiers.get(message.data);
  if (notifier)
    notifier.shutdown();
}

/**
 * Creates a notifier object for a particular window. After creation the window
 * will first be scanned for previously saved requests. Once that scan is
 * complete only new requests for this window will be reported.
 * @param {Window} window  window to attach the notifier to
 * @param {Integer} notifierID  Parent notifier ID to be messaged
 */
function RequestNotifier(window, notifierID)
{
  this.window = window;
  this.id = notifierID;
  notifiers.set(this.id, this);
  this.startScan(window);
}
exports.RequestNotifier = RequestNotifier;

RequestNotifier.prototype =
{
  /**
   * Parent notifier ID to be messaged
   * @type Integer
   */
  id: null,

  /**
   * The window this notifier is associated with.
   * @type Window
   */
  window: null,

  /**
   * Shuts down the notifier once it is no longer used. The listener
   * will no longer be called after that.
   */
  shutdown: function()
  {
    delete this.window;
    notifiers.delete(this.id);
  },

  /**
   * Notifies the parent about a new request.
   * @param {Object} entry
   */
  notifyListener: function(entry)
  {
    sendAsyncMessage("AdblockPlus:FoundNodeData", {
      notifierID: this.id,
      data: entry
    });
  },

  onComplete: function()
  {
    sendAsyncMessage("AdblockPlus:ScanComplete", this.id);
  },

  /**
   * Number of currently posted scan events (will be 0 when the scan finishes
   * running).
   */
  eventsPosted: 0,

  /**
   * Starts the initial scan of the window (will recurse into frames).
   * @param {Window} wnd  the window to be scanned
   */
  startScan: function(wnd)
  {
    let doc = wnd.document;
    let walker = doc.createTreeWalker(doc, Ci.nsIDOMNodeFilter.SHOW_ELEMENT, null, false);

    let process = function()
    {
      // Don't do anything if the notifier was shut down already.
      if (!this.window)
        return;

      let node = walker.currentNode;
      let data = nodeData.get(node);
      if (typeof data != "undefined")
        for (let k in data)
          this.notifyListener(data[k]);

      if (walker.nextNode())
        Utils.runAsync(process);
      else
      {
        // Done with the current window, start the scan for its frames
        for (let i = 0; i < wnd.frames.length; i++)
          this.startScan(wnd.frames[i]);

        this.eventsPosted--;
        if (!this.eventsPosted)
        {
          this.scanComplete = true;
          this.onComplete();
        }
      }
    }.bind(this);

    // Process each node in a separate event to allow other events to process
    this.eventsPosted++;
    Utils.runAsync(process);
  }
};

/**
 * Attaches request data to a DOM node.
 * @param {Node} node   node to attach data to
 * @param {Window} topWnd   top-level window the node belongs to
 * @param {String} contentType   request type, e.g. "IMAGE"
 * @param {String} docDomain  domain of the document that initiated the request
 * @param {Boolean} thirdParty  will be true if a third-party server has been requested
 * @param {String} location   the address that has been requested
 * @param {Filter} filter   filter applied to the request or null if none
 */
RequestNotifier.addNodeData = function(node, topWnd, contentType, docDomain, thirdParty, location, filter)
{
  let entry = {
    id: ++requestEntryMaxId,
    type: contentType,
    docDomain, thirdParty, location, filter
  };

  let existingData = nodeData.get(node);
  if (typeof existingData == "undefined")
  {
    existingData = {};
    nodeData.set(node, existingData);
  }

  // Add this request to the node data
  existingData[contentType + " " + location] = entry;

  // Update window statistics
  if (!windowStats.has(topWnd.document))
  {
    windowStats.set(topWnd.document, {
      items: 0,
      hidden: 0,
      blocked: 0,
      whitelisted: 0,
      filters: {}
    });
  }

  let stats = windowStats.get(topWnd.document);
  let filterType = (filter ? filter.type : null);
  if (filterType != "elemhide" && filterType != "elemhideexception" && filterType != "cssproperty")
    stats.items++;
  if (filter)
  {
    if (filterType == "blocking")
      stats.blocked++;
    else if (filterType == "whitelist" || filterType == "elemhideexception")
      stats.whitelisted++;
    else if (filterType == "elemhide" || filterType == "cssproperty")
      stats.hidden++;

    if (filter.text in stats.filters)
      stats.filters[filter.text]++;
    else
      stats.filters[filter.text] = 1;
  }

  // Notify listeners
  for (let notifier of notifiers.values())
    if (!notifier.window || notifier.window == topWnd)
      notifier.notifyListener(entry);
}
