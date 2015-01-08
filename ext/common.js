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

(function(global)
{
  const Ci = Components.interfaces;

  if (!global.ext)
    global.ext = {};

  var holder = {
    get Page()
    {
      delete this.Page;
      this.Page = (typeof require == "function" ?
          require("ext_background").Page :
          function() {});
      return this.Page;
    }
  };

  var getSender = global.ext._getSender = function(origin)
  {
    if (origin instanceof Ci.nsIDOMXULElement)
      return origin.messageManager;
    else if (origin instanceof Ci.nsIMessageSender)
      return origin;
    else
      return null;
  }

  var MessageProxy = global.ext._MessageProxy = function(messageManager, messageTarget)
  {
    this._messageManager = messageManager;
    this._messageTarget = messageTarget;
    this._callbacks = new Map();
    this._responseCallbackCounter = 0;

    this._handleRequest = this._handleRequest.bind(this);
    this._handleResponse = this._handleResponse.bind(this);
    this._messageManager.addMessageListener("AdblockPlus:Message", this._handleRequest);
    this._messageManager.addMessageListener("AdblockPlus:Response", this._handleResponse);
  }
  MessageProxy.prototype = {
    _disconnect: function()
    {
      this._messageManager.removeMessageListener("AdblockPlus:Message", this._handleRequest);
      this._messageManager.removeMessageListener("AdblockPlus:Response", this._handleResponse);
    },

    _sendResponse: function(sender, callbackId, message)
    {
      var response = {
        callbackId: callbackId
      };
      if (typeof response != "undefined")
        response.payload = message;
      sender.sendAsyncMessage("AdblockPlus:Response", response);
    },

    _handleRequest: function(message)
    {
      var sender = getSender(message.target);
      var request = message.data;

      var sent = false;
      var sendResponse;
      if (sender && "callbackId" in request)
      {
        sendResponse = function(message)
        {
          this._sendResponse(sender, request.callbackId, message);
          sent = true;
        }.bind(this);
      }
      else
        sendResponse = function() {};

      var results = this._messageTarget._dispatch(request.payload, {
        page: new holder.Page(sender)
      }, sendResponse);
      if (!sent && results.indexOf(true) == -1)
        sendResponse(undefined);
    },

    _handleResponse: function(message)
    {
      var response = message.data;
      var callback = this._callbacks.get(response.callbackId);
      if (callback)
      {
        this._callbacks.delete(response.callbackId);
        if ("payload" in response)
          callback(response.payload);
      }
    },

    sendMessage: function(message, responseCallback)
    {
      if (!(this._messageManager instanceof Ci.nsIMessageSender))
        throw new Error("Not implemented");

      var request = {
        payload: message
      };
      if (responseCallback)
      {
        request.callbackId = ++this._responseCallbackCounter;
        this._callbacks.set(request.callbackId, responseCallback);
      }

      this._messageManager.sendAsyncMessage("AdblockPlus:Message", request);
    }
  };

  var EventTarget = global.ext._EventTarget = function()
  {
    this._listeners = [];
  };
  EventTarget.prototype = {
    addListener: function(listener)
    {
      if (this._listeners.indexOf(listener) == -1)
        this._listeners.push(listener);
    },
    removeListener: function(listener)
    {
      var idx = this._listeners.indexOf(listener);
      if (idx != -1)
        this._listeners.splice(idx, 1);
    },
    _dispatch: function()
    {
      var results = [];

      for (var i = 0; i < this._listeners.length; i++)
        results.push(this._listeners[i].apply(null, arguments));

      return results;
    }
  };

  if (typeof exports == "object")
    exports = global.ext;
})(this);
