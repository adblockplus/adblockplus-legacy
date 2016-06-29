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
 * @fileOverview Hit counts for element hiding.
 */

try
{
  // Hack: SDK loader masks our Components object with a getter.
  let proto = Object.getPrototypeOf(this);
  let property = Object.getOwnPropertyDescriptor(proto, "Components");
  if (property && property.get)
    delete proto.Components;
}
catch (e)
{
  Cu.reportError(e);
}

let {XPCOMUtils} = Cu.import("resource://gre/modules/XPCOMUtils.jsm", {});

let {shouldAllowAsync} = require("child/contentPolicy");
let {port} = require("messaging");
let {Utils} = require("utils");

// The allowXBL binding below won't have any effect on the element. For elements
// that should be hidden however we don't return any binding at all, this makes
// Gecko stop constructing the node - it cannot be shown.
const allowXBL = "<bindings xmlns='http://www.mozilla.org/xbl'><binding id='dummy' bindToUntrustedContent='true'/></bindings>";
const hideXBL = "<bindings xmlns='http://www.mozilla.org/xbl'/>";

const notImplemented = () => Cr.NS_ERROR_NOT_IMPLEMENTED;

/**
 * about: URL module used to count hits.
 * @class
 */
let AboutHandler =
{
  classID: Components.ID("{55fb7be0-1dd2-11b2-98e6-9e97caf8ba67}"),
  classDescription: "Element hiding hit registration protocol handler",
  aboutPrefix: "abp-elemhide",

  /**
   * Registers handler on startup.
   */
  init: function()
  {
    let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    registrar.registerFactory(this.classID, this.classDescription,
        "@mozilla.org/network/protocol/about;1?what=" + this.aboutPrefix, this);
    onShutdown.add(function()
    {
      registrar.unregisterFactory(this.classID, this);
    }.bind(this));
  },

  //
  // Factory implementation
  //

  createInstance: function(outer, iid)
  {
    if (outer != null)
      throw Cr.NS_ERROR_NO_AGGREGATION;

    return this.QueryInterface(iid);
  },

  //
  // About module implementation
  //

  getURIFlags: function(uri)
  {
    return Ci.nsIAboutModule.HIDE_FROM_ABOUTABOUT;
  },

  newChannel: function(uri, loadInfo)
  {
    let match = /\?(?:hit(\d+)|css)$/.exec(uri.path);
    if (!match)
      throw Cr.NS_ERROR_FAILURE;

    if (match[1])
      return new HitRegistrationChannel(uri, loadInfo, match[1]);
    else
      return new StyleDataChannel(uri, loadInfo);
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIFactory, Ci.nsIAboutModule])
};
AboutHandler.init();

/**
 * Base class for channel implementations, subclasses usually only need to
 * override BaseChannel._getResponse() method.
 * @constructor
 */
function BaseChannel(uri, loadInfo)
{
  this.URI = this.originalURI = uri;
  this.loadInfo = loadInfo;
}
BaseChannel.prototype = {
  URI: null,
  originalURI: null,
  contentCharset: "utf-8",
  contentLength: 0,
  contentType: null,
  owner: Utils.systemPrincipal,
  securityInfo: null,
  notificationCallbacks: null,
  loadFlags: 0,
  loadGroup: null,
  name: null,
  status: Cr.NS_OK,

  _getResponse: notImplemented,

  _checkSecurity: function()
  {
    if (!this.loadInfo.triggeringPrincipal.equals(Utils.systemPrincipal))
      throw Cr.NS_ERROR_FAILURE;
  },

  asyncOpen: function(listener, context)
  {
    Promise.resolve(this._getResponse()).then(data =>
    {
      let stream = Cc["@mozilla.org/io/string-input-stream;1"]
                     .createInstance(Ci.nsIStringInputStream);
      stream.setData(data, data.length);

      try
      {
        listener.onStartRequest(this, context);
      }
      catch(e)
      {
        // Listener failing isn't our problem
      }

      try
      {
        listener.onDataAvailable(this, context, stream, 0, stream.available());
      }
      catch(e)
      {
        // Listener failing isn't our problem
      }

      try
      {
        listener.onStopRequest(this, context, Cr.NS_OK);
      }
      catch(e)
      {
        // Listener failing isn't our problem
      }
    });
  },

  asyncOpen2: function(listener)
  {
    this._checkSecurity();
    this.asyncOpen(listener, null);
  },

  open: function()
  {
    let data = this._getResponse();
    if (typeof data.then == "function")
      throw Cr.NS_ERROR_NOT_IMPLEMENTED;

    let stream = Cc["@mozilla.org/io/string-input-stream;1"]
                   .createInstance(Ci.nsIStringInputStream);
    stream.setData(data, data.length);
    return stream;
  },

  open2: function()
  {
    this._checkSecurity();
    return this.open();
  },

  isPending: () => false,
  cancel: notImplemented,
  suspend: notImplemented,
  resume: notImplemented,

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIChannel, Ci.nsIRequest])
};

/**
 * Channel returning CSS data for the global stylesheet.
 * @constructor
 */
function StyleDataChannel(uri, loadInfo)
{
  BaseChannel.call(this, uri, loadInfo);
}
StyleDataChannel.prototype = {
  __proto__: BaseChannel.prototype,
  contentType: "text/css",

  _getResponse: function()
  {
    function escapeChar(match)
    {
      return "\\" + match.charCodeAt(0).toString(16) + " ";
    }

    // Would be great to avoid sync messaging here but nsIStyleSheetService
    // insists on opening channels synchronously.
    let domains = port.emitSync("getSelectors");

    let cssPrefix = "{-moz-binding: url(about:abp-elemhide?hit";
    let cssSuffix = "#dummy) !important;}\n";
    let result = [];

    for (let [domain, selectors] of domains)
    {
      if (domain)
      {
        result.push('@-moz-document domain("',
            domain.replace(/[^\x01-\x7F]/g, escapeChar)
                  .split(",").join('"),domain("'),
            '"){\n');
      }
      else
      {
        // Only allow unqualified rules on a few protocols to prevent them
        // from blocking chrome content
        result.push('@-moz-document url-prefix("http://"),',
            'url-prefix("https://"),url-prefix("mailbox://"),',
            'url-prefix("imap://"),url-prefix("news://"),',
            'url-prefix("snews://"){\n');
      }

      for (let [selector, key] of selectors)
      {
        result.push(selector.replace(/[^\x01-\x7F]/g, escapeChar),
            cssPrefix, key, cssSuffix);
      }

      result.push("}\n");
    }

    return result.join("");
  }
};

/**
 * Channel returning data for element hiding hits.
 * @constructor
 */
function HitRegistrationChannel(uri, loadInfo, key)
{
  BaseChannel.call(this, uri, loadInfo);
  this.key = key;
}
HitRegistrationChannel.prototype = {
  __proto__: BaseChannel.prototype,
  key: null,
  contentType: "text/xml",

  _getResponse: function()
  {
    return new Promise((resolve, reject) =>
    {
      let window = Utils.getRequestWindow(this);
      shouldAllowAsync(window, window.document, "ELEMHIDE", this.key, allow =>
      {
        resolve(allow ? allowXBL : hideXBL);
      });
    });
  }
};
