/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

/**
 * @fileOverview Element hiding protocol to be loaded in the content process for a multi-process setup (currently only Fennec)
 */

var EXPORTED_SYMBOLS = ["ElemHideRemote"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("chrome://adblockplus-modules/content/Utils.jsm");

/**
 * Currently applied stylesheet URL
 * @type nsIURI
 */
let styleURL = null;

/**
 * nsIAboutModule implementation
 * @class
 */
var ElemHideRemote =
{
  classID: Components.ID("{55fb7be0-1dd2-11b2-98e6-9e97caf8ba67}"),
  classDescription: "Element hiding hit registration protocol handler",
  aboutPrefix: "abp-elemhidehit",

  startup: function()
  {
    let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    registrar.registerFactory(ElemHideRemote.classID, ElemHideRemote.classDescription,
        "@mozilla.org/network/protocol/about;1?what=" + ElemHideRemote.aboutPrefix, ElemHideRemote);

    styleURL = Utils.makeURI(Utils.childMessageManager.sendSyncMessage("AdblockPlus:ElemHide:styleURL"));
    if (styleURL)
      Utils.styleService.loadAndRegisterSheet(styleURL, Ci.nsIStyleSheetService.USER_SHEET);

    // Get notified about style URL changes
    Utils.childMessageManager.addMessageListener("AdblockPlus:ElemHide:updateStyleURL", function(message)
    {
      if (styleURL)
        Utils.styleService.unregisterSheet(styleURL, Ci.nsIStyleSheetService.USER_SHEET);

      styleURL = Utils.makeURI(message.json);
      if (styleURL)
        Utils.styleService.loadAndRegisterSheet(styleURL, Ci.nsIStyleSheetService.USER_SHEET);
    });
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

  newChannel: function(uri)
  {
    if (!/\?(\d+)/.test(uri.path))
      throw Cr.NS_ERROR_FAILURE;

    return new HitRegistrationChannel(uri, RegExp.$1);
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIFactory, Ci.nsIAboutModule])
};

/**
 * Channel returning data for element hiding hits.
 * @constructor
 */
function HitRegistrationChannel(uri, key)
{
  this.key = key;
  this.URI = this.originalURI = uri;
}
HitRegistrationChannel.prototype = {
  key: null,
  URI: null,
  originalURI: null,
  contentCharset: "utf-8",
  contentLength: 0,
  contentType: "text/xml",
  owner: Utils.systemPrincipal,
  securityInfo: null,
  notificationCallbacks: null,
  loadFlags: 0,
  loadGroup: null,
  name: null,
  status: Cr.NS_OK,

  asyncOpen: function(listener, context)
  {
    let stream = this.open();
    Utils.runAsync(function()
    {
      try {
        listener.onStartRequest(this, context);
      } catch(e) {}
      try {
        listener.onDataAvailable(this, context, stream, 0, stream.available());
      } catch(e) {}
      try {
        listener.onStopRequest(this, context, Cr.NS_OK);
      } catch(e) {}
    }, this);
  },

  open: function()
  {
    let data = "<bindings xmlns='http://www.mozilla.org/xbl'><binding id='dummy'/></bindings>";
    let wnd = Utils.getRequestWindow(this);

    if (wnd)
    {
      wnd = Utils.getOriginWindow(wnd);

      let locations = [];
      let testWnd = wnd;
      while (true)
      {
        locations.push(testWnd.location.href);
        if (testWnd.parent == testWnd)
          break;
        else
          testWnd = testWnd.parent;
      }

      let result = Utils.childMessageManager.sendSyncMessage("AdblockPlus:ElemHide:checkHit", {
                key: this.key,
                locations: locations})[0];
      if (result)
        data = "<bindings xmlns='http://www.mozilla.org/xbl'/>";
    }

    let stream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
    stream.setData(data, data.length);
    return stream;
  },
  isPending: function()
  {
    return false;
  },
  cancel: function()
  {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },
  suspend: function()
  {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },
  resume: function()
  {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIChannel, Ci.nsIRequest])
};

ElemHideRemote.startup();
