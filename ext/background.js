/*
 * This file is part of Adblock Plus <http://adblockplus.org/>,
 * Copyright (C) 2006-2014 Eyeo GmbH
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

let {XPCOMUtils} = Cu.import("resource://gre/modules/XPCOMUtils.jsm", null);
let {Services} = Cu.import("resource://gre/modules/Services.jsm", null);
let {
  _MessageProxy: MessageProxy,
  _EventTarget: EventTarget,
  _getSender: getSender
} = require("ext_common");
exports.onMessage = new EventTarget();

let messageProxy = new MessageProxy(
    Cc["@mozilla.org/globalmessagemanager;1"]
      .getService(Ci.nsIMessageListenerManager),
    exports.onMessage);
onShutdown.add(function()
{
  messageProxy._disconnect();
});

function Page(sender)
{
  this._sender = sender;
}
Page.prototype = {
  sendMessage: function(message)
  {
    if (this._sender)
      this._sender.sendAsyncMessage("AdblockPlus:Message", {payload: message});
  }
};
exports.Page = Page;

function PageMap()
{
  this._map = new Map();

  Services.obs.addObserver(this, "message-manager-disconnect", true);
  onShutdown.add(function()
  {
    Services.obs.removeObserver(this, "message-manager-disconnect");
  }.bind(this));
}
PageMap.prototype = {
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference]),

  observe: function(subject, topic, data)
  {
    if (topic == "message-manager-disconnect")
      this._map.delete(subject);
  },

  keys: function()
  {
    let result = [];
    for (let sender of this._map.keys())
      result.push(new Page(sender));
    return result;
  },

  get: function(page)
  {
    return this._map.get(page._sender);
  },

  set: function(page, value)
  {
    if (page._sender)
      this._map.set(page._sender, value);
  },

  has: function(page)
  {
    return this._map.has(page._sender);
  },

  delete: function(page)
  {
    this._map.delete(page._sender);
  }
};
exports.PageMap = PageMap;
