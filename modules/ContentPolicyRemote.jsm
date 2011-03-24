/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Adblock Plus.
 *
 * The Initial Developer of the Original Code is
 * Fabrice Desré.
 * Portions created by the Initial Developer are Copyright (C) 2006-2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *  Wladimir Palant
 *
 * ***** END LICENSE BLOCK ***** */

/**
 * @fileOverview Content policy to be loaded in the content process for a multi-process setup (currently only Fennec)
 */

var EXPORTED_SYMBOLS = ["PolicyRemote"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("chrome://adblockplus-modules/content/Utils.jsm");

/**
 * nsIContentPolicy and nsIChannelEventSink implementation
 * @class
 */
var PolicyRemote =
{
  classDescription: "Adblock Plus content policy",
  classID: Components.ID("094560a0-4fed-11e0-b8af-0800200c9a66"),
  contractID: "@adblockplus.org/abp/policy-remote;1",
  xpcom_categories: ["content-policy", "net-channel-event-sinks"],

  cache: new Cache(512),

  startup: function()
  {
    let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    try
    {
      registrar.registerFactory(PolicyRemote.classID, PolicyRemote.classDescription, PolicyRemote.contractID, PolicyRemote);
    }
    catch (e)
    {
      // Don't stop on errors - the factory might already be registered
      Cu.reportError(e);
    }

    let catMan = Utils.categoryManager;
    for each (let category in PolicyRemote.xpcom_categories)
      catMan.addCategoryEntry(category, PolicyRemote.classDescription, PolicyRemote.contractID, false, true);

    Utils.observerService.addObserver(PolicyRemote, "http-on-modify-request", true);

    // Generate class identifier used to collapse node and register corresponding
    // stylesheet.
    let offset = "a".charCodeAt(0);
    Utils.collapsedClass = "";
    for (let i = 0; i < 20; i++)
      Utils.collapsedClass +=  String.fromCharCode(offset + Math.random() * 26);

    let collapseStyle = Utils.makeURI("data:text/css," +
                                      encodeURIComponent("." + Utils.collapsedClass +
                                      "{-moz-binding: url(chrome://global/content/bindings/general.xml#foobarbazdummy) !important;}"));
    Utils.styleService.loadAndRegisterSheet(collapseStyle, Ci.nsIStyleSheetService.USER_SHEET);

    // Get notified if we need to invalidate our matching cache
    Utils.childMessageManager.addMessageListener("AdblockPlus:Matcher:clearCache", function(message)
    {
      PolicyRemote.cache.clear();
    });
  },

  //
  // nsISupports interface implementation
  //

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIContentPolicy, Ci.nsIObserver,
    Ci.nsIChannelEventSink, Ci.nsIFactory, Ci.nsISupportsWeakReference]),

  //
  // nsIContentPolicy interface implementation
  //

  shouldLoad: function(contentType, contentLocation, requestOrigin, node, mimeTypeGuess, extra)
  {
    // Ignore requests without context and top-level documents
    if (!node || contentType == Ci.nsIContentPolicy.TYPE_DOCUMENT)
      return Ci.nsIContentPolicy.ACCEPT;

    let wnd = Utils.getWindow(node);
    if (!wnd)
      return Ci.nsIContentPolicy.ACCEPT;

    wnd = Utils.getOriginWindow(wnd);

    let wndLocation = wnd.location.href;
    let topLocation = wnd.top.location.href;
    let key = contentType + " " + contentLocation.spec + " " + wndLocation + " " + topLocation;
    if (!(key in this.cache.data))
    {
      this.cache.add(key, Utils.childMessageManager.sendSyncMessage("AdblockPlus:Policy:shouldLoad", {
              contentType: contentType,
              contentLocation: contentLocation.spec,
              wndLocation: wnd.location.href,
              topLocation: wnd.top.location.href})[0]);
    }

    let result = this.cache.data[key];
    if (result.value == Ci.nsIContentPolicy.ACCEPT)
    {
      // We didn't block this request so we will probably see it again in
      // http-on-modify-request. Keep it so that we can associate it with the
      // channel there - will be needed in case of redirect.
      PolicyRemote.previousRequest = [node, contentType, Utils.unwrapURL(contentLocation)];
    }
    else if (result.postProcess)
      Utils.schedulePostProcess(node);
    return result.value;
  },

  shouldProcess: function(contentType, contentLocation, requestOrigin, insecNode, mimeType, extra)
  {
    return Ci.nsIContentPolicy.ACCEPT;
  },

  //
  // nsIObserver interface implementation
  //
  observe: function(subject, topic, data)
  {
    if (topic != "http-on-modify-request"  || !(subject instanceof Ci.nsIHttpChannel))
      return;

    // TODO: Do-not-track header

    if (PolicyRemote.previousRequest && subject.URI == PolicyRemote.previousRequest[2] &&
        subject instanceof Ci.nsIWritablePropertyBag)
    {
      // We just handled a content policy call for this request - associate
      // the data with the channel so that we can find it in case of a redirect.
      subject.setProperty("abpRequestData", PolicyRemote.previousRequest);
      PolicyRemote.previousRequest = null;
    }
  },

  //
  // nsIChannelEventSink interface implementation
  //

  onChannelRedirect: function(oldChannel, newChannel, flags)
  {
    try
    {
      let oldLocation = null;
      let newLocation = null;
      try
      {
        oldLocation = oldChannel.originalURI.spec;
        newLocation = newChannel.URI.spec;
      }
      catch(e2) {}

      if (!oldLocation || !newLocation || oldLocation == newLocation)
        return;

      // Try to retrieve previously stored request data from the channel
      let requestData = null;
      try
      {
        if (oldChannel instanceof Ci.nsIWritablePropertyBag)
          requestData = oldChannel.getProperty("abpRequestData");
      }
      catch(e) {}  // Ignore exceptions due to non-existing property
      if (!requestData)
        return;
      oldChannel.deleteProperty("abpRequestData");

      // HACK: NS_BINDING_ABORTED would be proper error code to throw but this will show up in error console (bug 287107)
      if (PolicyRemote.shouldLoad(requestData[1], newChannel.URI, null, requestData[0]) != Ci.nsIContentPolicy.ACCEPT)
        throw Cr.NS_BASE_STREAM_WOULD_BLOCK;
      else
      {
        // We allowed the request to proceed, associate the data with the new channel
        if (newChannel instanceof Ci.nsIWritablePropertyBag)
          newChannel.getProperty("abpRequestData", requestData);
        return;
      }
    }
    catch (e if (e != Cr.NS_BASE_STREAM_WOULD_BLOCK))
    {
      // We shouldn't throw exceptions here - this will prevent the redirect.
      Cu.reportError(e);
    }
  },

  asyncOnChannelRedirect: function(oldChannel, newChannel, flags, callback)
  {
    this.onChannelRedirect(oldChannel, newChannel, flags);

    // If onChannelRedirect didn't throw an exception indicate success
    callback.onRedirectVerifyCallback(Cr.NS_OK);
  },

  //
  // nsIFactory interface implementation
  //

  createInstance: function(outer, iid)
  {
    if (outer)
      throw Cr.NS_ERROR_NO_AGGREGATION;
    return this.QueryInterface(iid);
  }
};

PolicyRemote.startup();
