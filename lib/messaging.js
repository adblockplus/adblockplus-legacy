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

"use strict";

const MESSAGE_NAME = "AdblockPlus:Message";
const RESPONSE_NAME = "AdblockPlus:Response";

function isPromise(value)
{
  // value instanceof Promise won't work - there can be different Promise
  // classes (e.g. in different contexts) and there can also be promise-like
  // classes (e.g. Task).
  return (value && typeof value.then == "function");
}

function sendMessage(messageManager, messageName, payload, callbackID)
{
  let request = {messageName, payload, callbackID};
  if (messageManager instanceof Ci.nsIMessageSender)
  {
    messageManager.sendAsyncMessage(MESSAGE_NAME, request);
    return 1;
  }
  else if (messageManager instanceof Ci.nsIMessageBroadcaster)
  {
    messageManager.broadcastAsyncMessage(MESSAGE_NAME, request);
    return messageManager.childCount;
  }
  else
  {
    Cu.reportError("Unexpected message manager, impossible to send message");
    return 0;
  }
}

function sendSyncMessage(messageManager, messageName, payload)
{
  let request = {messageName, payload};
  let responses = messageManager.sendRpcMessage(MESSAGE_NAME, request);
  let processor = new ResponseProcessor(messageName);
  for (let response of responses)
    processor.add(response);
  return processor.value;
}

function ResponseProcessor(messageName)
{
  this.value = undefined;
  this.add = function(response)
  {
    if (typeof response == "undefined")
      return;

    if (typeof this.value == "undefined")
      this.value = response;
    else
      Cu.reportError("Got multiple responses to message '" + messageName + "', only first response was accepted.");
  };
}

function getSender(origin)
{
  if (origin instanceof Ci.nsIDOMXULElement)
    origin = origin.messageManager;

  if (origin instanceof Ci.nsIMessageSender)
    return new LightWeightPort(origin);
  else
    return null;
}

/**
 * Lightweight communication port allowing only sending messages.
 * @param {nsIMessageManager} messageManager
 * @constructor
 */
function LightWeightPort(messageManager)
{
  this._messageManager = messageManager;
}
LightWeightPort.prototype =
{
  /**
   * @see Port#emit
   */
  emit: function(messageName, payload)
  {
    sendMessage(this._messageManager, messageName, payload);
  },

  /**
   * @see Port#emitSync
   */
  emitSync: function(messageName, payload)
  {
    return sendSyncMessage(this._messageManager, messageName, payload);
  }
};

/**
 * Communication port wrapping the message manager API to send and receive
 * messages.
 * @param {nsIMessageManager} messageManager
 * @constructor
 */
function Port(messageManager)
{
  this._messageManager = messageManager;

  this._callbacks = new Map();
  this._responseCallbacks = new Map();
  this._responseCallbackCounter = 0;

  this._handleRequest = this._handleRequest.bind(this);
  this._handleResponse = this._handleResponse.bind(this);
  this._messageManager.addMessageListener(MESSAGE_NAME, this._handleRequest);
  this._messageManager.addMessageListener(RESPONSE_NAME, this._handleResponse);
}
Port.prototype = {
  /**
   * Disables the port and makes it stop listening to incoming messages.
   */
  disconnect: function()
  {
    this._messageManager.removeMessageListener(MESSAGE_NAME, this._handleRequest);
    this._messageManager.removeMessageListener(RESPONSE_NAME, this._handleResponse);
  },

  _sendResponse: function(sender, callbackID, payload)
  {
    if (!sender || typeof callbackID == "undefined")
      return;

    let response = {callbackID, payload};
    sender._messageManager.sendAsyncMessage(RESPONSE_NAME, response);
  },

  _handleRequest: function(message)
  {
    let sender = getSender(message.target);
    let {callbackID, messageName, payload} = message.data;

    let result = this._dispatch(messageName, payload, sender);
    if (isPromise(result))
    {
      // This is a promise - asynchronous response
      if (message.sync)
      {
        Cu.reportError("Asynchronous response to the synchronous message '" + messageName + "' is not possible");
        return undefined;
      }

      result.then(result =>
      {
        this._sendResponse(sender, callbackID, result)
      }, e =>
      {
        Cu.reportError(e);
        this._sendResponse(sender, callbackID, undefined);
      });
    }
    else
      this._sendResponse(sender, callbackID, result);

    return result;
  },

  _handleResponse: function(message)
  {
    let {callbackID, payload} = message.data;
    let callbackData = this._responseCallbacks.get(callbackID);
    if (!callbackData)
      return;

    let [callback, processor, expectedResponses] = callbackData;

    try
    {
      processor.add(payload);
    }
    catch (e)
    {
      Cu.reportError(e);
    }

    callbackData[2] = --expectedResponses;
    if (expectedResponses <= 0)
    {
      this._responseCallbacks.delete(callbackID);
      callback(processor.value);
    }
  },

  _dispatch: function(messageName, payload, sender)
  {
    let callbacks = this._callbacks.get(messageName);
    if (!callbacks)
      return undefined;

    callbacks = callbacks.slice();
    let processor = new ResponseProcessor(messageName);
    for (let callback of callbacks)
    {
      try
      {
        processor.add(callback(payload, sender));
      }
      catch (e)
      {
        Cu.reportError(e);
      }
    }
    return processor.value;
  },

  /**
   * Function to be called when a particular message is received
   * @callback Port~messageHandler
   * @param payload data attached to the message if any
   * @param {LightWeightPort} sender object that can be used to communicate with
   *      the sender of the message, could be null
   * @return the handler can return undefined (no response), a value (response
   *      to be sent to sender immediately) or a promise (asynchronous
   *      response).
   */

  /**
   * Adds a handler for the specified message.
   * @param {string} messageName message that would trigger the callback
   * @param {Port~messageHandler} callback
   */
  on: function(messageName, callback)
  {
    let callbacks = this._callbacks.get(messageName);
    if (callbacks)
      callbacks.push(callback);
    else
      this._callbacks.set(messageName, [callback]);
  },

  /**
   * Removes a handler for the specified message.
   * @param {string} messageName message that would trigger the callback
   * @param {Port~messageHandler} callback
   */
  off: function(messageName, callback)
  {
    let callbacks = this._callbacks.get(messageName);
    if (!callbacks)
      return;

    let index = callbacks.indexOf(callback);
    if (index >= 0)
      callbacks.splice(index, 1);
  },

  /**
   * Sends a message.
   * @param {string} messageName message identifier
   * @param [payload] data to attach to the message
   */
  emit: function(messageName, payload)
  {
    sendMessage(this._messageManager, messageName, payload, undefined);
  },

  /**
   * Sends a message and expects a response.
   * @param {string} messageName message identifier
   * @param [payload] data to attach to the message
   * @return {Promise} promise that will be resolved with the response
   */
  emitWithResponse: function(messageName, payload)
  {
    let callbackID = ++this._responseCallbackCounter;
    let expectedResponses = sendMessage(
        this._messageManager, messageName, payload, callbackID);
    return new Promise((resolve, reject) =>
    {
      this._responseCallbacks.set(callbackID,
          [resolve, new ResponseProcessor(messageName), expectedResponses]);
    });
  },

  /**
   * Sends a synchonous message (DO NOT USE unless absolutely unavoidable).
   * @param {string} messageName message identifier
   * @param [payload] data to attach to the message
   * @return response returned by the handler
   */
  emitSync: function(messageName, payload)
  {
    return sendSyncMessage(this._messageManager, messageName, payload);
  }
};
exports.Port = Port;

let messageManager;
try
{
  // Child
  messageManager = require("messageManager");
}
catch (e)
{
  // Parent
  messageManager = Cc["@mozilla.org/parentprocessmessagemanager;1"]
                     .getService(Ci.nsIMessageListenerManager);
}

let port = new Port(messageManager);
onShutdown.add(() => port.disconnect());
exports.port = port;
