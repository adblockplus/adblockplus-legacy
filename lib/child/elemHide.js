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
 * @fileOverview Serves CSS for element hiding and processes hits.
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
let {Services} = Cu.import("resource://gre/modules/Services.jsm", {});

let {shouldAllowAsync} = require("child/contentPolicy");
let {getFrames, isPrivate, getRequestWindow} = require("child/utils");
let {RequestNotifier} = require("child/requestNotifier");
let {port} = require("messaging");
let {Utils} = require("utils");

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
    let match = /\?hit(\d+)$/.exec(uri.path);
    if (match)
      return new HitRegistrationChannel(uri, loadInfo, match[1]);

    match = /\?css(?:=(.*?))?(&specificonly)?$/.exec(uri.path);
    if (match)
    {
      return new StyleDataChannel(uri, loadInfo,
            match[1] ? decodeURIComponent(match[1]) : null, !!match[2]);
    }

    throw Cr.NS_ERROR_FAILURE;
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
 * Channel returning CSS data for the global as well as site-specific stylesheet.
 * @constructor
 */
function StyleDataChannel(uri, loadInfo, domain, specificOnly)
{
  BaseChannel.call(this, uri, loadInfo);
  this._domain = domain;
  this._specificOnly = specificOnly;
}
StyleDataChannel.prototype = {
  __proto__: BaseChannel.prototype,
  contentType: "text/css",
  _domain: null,

  _getResponse: function()
  {
    function escapeChar(match)
    {
      return "\\" + match.charCodeAt(0).toString(16) + " ";
    }

    // Would be great to avoid sync messaging here but nsIStyleSheetService
    // insists on opening channels synchronously.
    let [selectors, keys] = (this._domain ?
        port.emitSync("getSelectorsForDomain", [this._domain, this._specificOnly]) :
        port.emitSync("getUnconditionalSelectors"));

    let cssPrefix = "{-moz-binding: url(about:abp-elemhide?hit";
    let cssSuffix = "#dummy) !important;}\n";
    let result = [];

    for (let i = 0; i < selectors.length; i++)
    {
      let selector = selectors[i];
      let key = keys[i];
      result.push(selector.replace(/[^\x01-\x7F]/g, escapeChar),
          cssPrefix, key, cssSuffix);
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
    let window = getRequestWindow(this);
    port.emitWithResponse("registerElemHideHit", {
      key: this.key,
      frames: getFrames(window),
      isPrivate: isPrivate(window)
    }).then(hit =>
    {
      if (hit)
        RequestNotifier.addNodeData(window.document, window.top, hit);
    });
    return "<bindings xmlns='http://www.mozilla.org/xbl'/>";
  }
};

let observer = {
  QueryInterface: XPCOMUtils.generateQI([
    Ci.nsIObserver, Ci.nsISupportsWeakReference
  ]),

  topic: "document-element-inserted",
  styleURL: Utils.makeURI("about:abp-elemhide?css"),
  sheet: null,

  init: function()
  {
    Services.obs.addObserver(this, this.topic, true);
    onShutdown.add(() =>
    {
      Services.obs.removeObserver(this, this.topic);
    });

    port.on("elemhideupdate", () =>
    {
      this.sheet = null;
    });
  },

  observe: function(subject, topic, data)
  {
    if (topic != this.topic)
      return;

    let window = subject.defaultView;
    if (!window)
    {
      // This is typically XBL bindings and SVG images, but also real
      // documents occasionally - probably due to speculative loading?
      return;
    }
    let type = window.QueryInterface(Ci.nsIInterfaceRequestor)
                     .getInterface(Ci.nsIWebNavigation)
                     .QueryInterface(Ci.nsIDocShellTreeItem)
                     .itemType;
    if (type != Ci.nsIDocShellTreeItem.typeContent)
      return;

    port.emitWithResponse("elemhideEnabled", {
      frames: getFrames(window),
      isPrivate: isPrivate(window)
    }).then(({
      enabled, contentType, docDomain, thirdParty, location, filter,
      filterType
    }) =>
    {
      if (Cu.isDeadWrapper(window))
      {
        // We are too late, the window is gone already.
        return;
      }

      if (enabled)
      {
        let utils = window.QueryInterface(Ci.nsIInterfaceRequestor)
                          .getInterface(Ci.nsIDOMWindowUtils);

        // If we have a filter hit at this point then it must be a $generichide
        // filter - apply only specific element hiding filters.
        let specificOnly = !!filter;
        if (!specificOnly)
        {
          if (!this.sheet)
          {
            this.sheet = Utils.styleService.preloadSheet(this.styleURL,
                Ci.nsIStyleSheetService.USER_SHEET);
          }

          try
          {
            utils.addSheet(this.sheet, Ci.nsIStyleSheetService.USER_SHEET);
          }
          catch (e)
          {
            // Ignore NS_ERROR_ILLEGAL_VALUE - it will be thrown if we try to add
            // the stylesheet multiple times to the same document (the observer
            // will be notified twice for some documents).
            if (e.result != Cr.NS_ERROR_ILLEGAL_VALUE)
              throw e;
          }
        }

        let host = window.location.hostname;
        if (host)
        {
          try
          {
            let suffix = "=" + encodeURIComponent(host);
            if (specificOnly)
              suffix += "&specificonly";
            utils.loadSheetUsingURIString(this.styleURL.spec + suffix,
                Ci.nsIStyleSheetService.USER_SHEET);
          }
          catch (e)
          {
            // Ignore NS_ERROR_ILLEGAL_VALUE - it will be thrown if we try to add
            // the stylesheet multiple times to the same document (the observer
            // will be notified twice for some documents).
            if (e.result != Cr.NS_ERROR_ILLEGAL_VALUE)
              throw e;
          }
        }
      }

      if (filter)
      {
        RequestNotifier.addNodeData(window.document, window.top, {
          contentType, docDomain, thirdParty, location, filter, filterType
        });
      }
    });
  }
};
observer.init();
