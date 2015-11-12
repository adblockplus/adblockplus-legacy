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
 * @fileOverview Content policy implementation, responsible for blocking things.
 */

"use strict";

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

let {Utils} = require("utils");
let {getFrames, isPrivate} = require("child/utils");
let {objectMouseEventHander} = require("objectTabs");
let {RequestNotifier} = require("child/requestNotifier");

/**
 * Randomly generated class name, to be applied to collapsed nodes.
 * @type string
 */
let collapsedClass = null;

/**
 * Maps numerical content type IDs to strings.
 * @type Map.<number,string>
 */
let types = new Map();

/**
 * Processes parent's response to the ShouldAllow message.
 * @param {nsIDOMWindow} window window that the request is associated with
 * @param {nsIDOMElement} node  DOM element that the request is associated with
 * @param {Object|undefined} response  object received as response
 * @return {Boolean} false if the request should be blocked
 */
function processPolicyResponse(window, node, response)
{
  if (typeof response == "undefined")
    return true;

  let {allow, collapse, hits} = response;
  let isObject = false;
  for (let {frameIndex, contentType, docDomain, thirdParty, location, filter} of hits)
  {
    if (contentType == "OBJECT")
      isObject = true;

    let context = node;
    if (typeof frameIndex == "number")
    {
      context = window;
      for (let i = 0; i < frameIndex; i++)
        context = context.parent;
      context = context.document;
    }
    RequestNotifier.addNodeData(context, window.top, contentType, docDomain, thirdParty, location, filter);
  }

  if (node.nodeType == Ci.nsIDOMNode.ELEMENT_NODE)
  {
    // Track mouse events for objects
    if (allow && isObject)
    {
      node.addEventListener("mouseover", objectMouseEventHander, true);
      node.addEventListener("mouseout", objectMouseEventHander, true);
    }

    if (collapse)
      schedulePostProcess(node);
  }
  return allow;
}

/**
 * Checks whether a request should be allowed, hides it if necessary
 * @param {nsIDOMWindow} window
 * @param {nsIDOMElement} node
 * @param {String} contentType
 * @param {String} location location of the request, filter key if contentType is ELEMHIDE
 * @return {Boolean} false if the request should be blocked
 */
let shouldAllow = exports.shouldAllow = function(window, node, contentType, location)
{
  return processPolicyResponse(window, node, sendSyncMessage("AdblockPlus:ShouldAllow", {
    contentType,
    location,
    frames: getFrames(window),
    isPrivate: isPrivate(window)
  }));
};

/**
 * Asynchronously checks whether a request should be allowed.
 * @param {nsIDOMWindow} window
 * @param {nsIDOMElement} node
 * @param {String} contentType
 * @param {String} location location of the request, filter key if contentType is ELEMHIDE
 * @param {Function} callback  callback to be called with a boolean value, if
 *                             false the request should be blocked
 */
let shouldAllowAsync = exports.shouldAllowAsync = function(window, node, contentType, location, callback)
{
  sendAsyncMessage("AdblockPlus:ShouldAllow", {
    contentType,
    location,
    frames: getFrames(window),
    isPrivate: isPrivate(window)
  }, response => callback(processPolicyResponse(window, node, response)));
};

/**
 * Actual nsIContentPolicy and nsIChannelEventSink implementation
 * @class
 */
var PolicyImplementation =
{
  classDescription: "Adblock Plus content policy",
  classID: Components.ID("cfeaabe6-1dd1-11b2-a0c6-cb5c268894c9"),
  contractID: "@adblockplus.org/abp/policy;1",
  xpcom_categories: ["content-policy", "net-channel-event-sinks"],

  /**
   * Registers the content policy on startup.
   */
  init: function()
  {
    // Populate types map
    let iface = Ci.nsIContentPolicy;
    for (let name in iface)
      if (name.indexOf("TYPE_") == 0 && name != "TYPE_DATAREQUEST")
        types.set(iface[name], name.substr(5));

    let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    registrar.registerFactory(this.classID, this.classDescription, this.contractID, this);

    let catMan = Utils.categoryManager;
    let addCategoryEntry = Utils.getPropertyWithoutCompatShims(catMan, "addCategoryEntry");
    for (let category of this.xpcom_categories)
      addCategoryEntry.call(catMan, category, this.contractID, this.contractID, false, true);

    let addObserver = Utils.getPropertyWithoutCompatShims(Services.obs, "addObserver");
    addObserver.call(Services.obs, this, "content-document-global-created", true);

    onShutdown.add(() =>
    {
      let removeObserver = Utils.getPropertyWithoutCompatShims(Services.obs, "removeObserver");
      removeObserver.call(Services.obs, this, "content-document-global-created");

      for (let category of this.xpcom_categories)
        catMan.deleteCategoryEntry(category, this.contractID, false);

      registrar.unregisterFactory(this.classID, this);
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

    // Ignore standalone objects
    if (contentType == Ci.nsIContentPolicy.TYPE_OBJECT && node.ownerDocument && !/^text\/|[+\/]xml$/.test(node.ownerDocument.contentType))
      return Ci.nsIContentPolicy.ACCEPT;

    let wnd = Utils.getWindow(node);
    if (!wnd)
      return Ci.nsIContentPolicy.ACCEPT;

    // Data loaded by plugins should be associated with the document
    if (contentType == Ci.nsIContentPolicy.TYPE_OBJECT_SUBREQUEST && node instanceof Ci.nsIDOMElement)
      node = node.ownerDocument;

    // Fix type for objects misrepresented as frames or images
    if (contentType != Ci.nsIContentPolicy.TYPE_OBJECT && (node instanceof Ci.nsIDOMHTMLObjectElement || node instanceof Ci.nsIDOMHTMLEmbedElement))
      contentType = Ci.nsIContentPolicy.TYPE_OBJECT;

    let location = Utils.unwrapURL(contentLocation);
    let result = shouldAllow(wnd, node, types.get(contentType), location.spec);
    return (result ? Ci.nsIContentPolicy.ACCEPT : Ci.nsIContentPolicy.REJECT_REQUEST);
  },

  shouldProcess: function(contentType, contentLocation, requestOrigin, insecNode, mimeType, extra)
  {
    return Ci.nsIContentPolicy.ACCEPT;
  },

  //
  // nsIObserver interface implementation
  //
  observe: function(subject, topic, data, additional)
  {
    switch (topic)
    {
      case "content-document-global-created":
      {
        if (!(subject instanceof Ci.nsIDOMWindow) || !subject.opener)
          return;

        let uri = additional || subject.location.href;
        if (!shouldAllow(subject.opener, subject.opener.document, "POPUP", uri))
        {
          subject.stop();
          Utils.runAsync(() => subject.close());
        }
        else if (uri == "about:blank")
        {
          // An about:blank pop-up most likely means that a load will be
          // initiated asynchronously. Wait for that.
          Utils.runAsync(() =>
          {
            let channel = subject.QueryInterface(Ci.nsIInterfaceRequestor)
                                 .getInterface(Ci.nsIDocShell)
                                 .QueryInterface(Ci.nsIDocumentLoader)
                                 .documentChannel;
            if (channel)
              this.observe(subject, topic, data, channel.URI.spec);
          });
        }
        break;
      }
    }
  },

  //
  // nsIChannelEventSink interface implementation
  //

  asyncOnChannelRedirect: function(oldChannel, newChannel, flags, callback)
  {
    let async = false;
    try
    {
      // nsILoadInfo.contentPolicyType was introduced in Gecko 35, then
      // renamed to nsILoadInfo.externalContentPolicyType in Gecko 44.
      let loadInfo = oldChannel.loadInfo;
      let contentType = ("externalContentPolicyType" in loadInfo ?
          loadInfo.externalContentPolicyType : loadInfo.contentPolicyType);
      if (!contentType)
        return;

      let wnd = Utils.getRequestWindow(newChannel);
      if (!wnd)
        return;

      if (contentType == Ci.nsIContentPolicy.TYPE_DOCUMENT)
      {
        if (wnd.history.length <= 1 && wnd.opener)
        {
          // Special treatment for pop-up windows - this will close the window
          // rather than preventing the redirect. Note that we might not have
          // seen the original channel yet because the redirect happened before
          // the async code in observe() had a chance to run.
          this.observe(wnd, "content-document-global-created", null, oldChannel.URI.spec);
          this.observe(wnd, "content-document-global-created", null, newChannel.URI.spec);
        }
        return;
      }

      shouldAllowAsync(wnd, wnd.document, types.get(contentType), newChannel.URI.spec, function(allow)
      {
        callback.onRedirectVerifyCallback(allow ? Cr.NS_OK : Cr.NS_BINDING_ABORTED);
      });
      async = true;
    }
    catch (e)
    {
      // We shouldn't throw exceptions here - this will prevent the redirect.
      Cu.reportError(e);
    }
    finally
    {
      if (!async)
        callback.onRedirectVerifyCallback(Cr.NS_OK);
    }
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
PolicyImplementation.init();

/**
 * Nodes scheduled for post-processing (might be null).
 * @type Node[]
 */
let scheduledNodes = null;

/**
 * Schedules a node for post-processing.
 */
function schedulePostProcess(/**Element*/ node)
{
  if (scheduledNodes)
    scheduledNodes.push(node);
  else
  {
    scheduledNodes = [node];
    Utils.runAsync(postProcessNodes);
  }
}

/**
 * Processes nodes scheduled for post-processing (typically hides them).
 */
function postProcessNodes()
{
  if (!collapsedClass)
    collapsedClass = sendSyncMessage("AdblockPlus:GetCollapsedClass");

  let nodes = scheduledNodes;
  scheduledNodes = null;

  if (!collapsedClass)
    return;

  for (let node of nodes)
  {
    // adjust frameset's cols/rows for frames
    let parentNode = node.parentNode;
    if (parentNode && parentNode instanceof Ci.nsIDOMHTMLFrameSetElement)
    {
      let hasCols = (parentNode.cols && parentNode.cols.indexOf(",") > 0);
      let hasRows = (parentNode.rows && parentNode.rows.indexOf(",") > 0);
      if ((hasCols || hasRows) && !(hasCols && hasRows))
      {
        let index = -1;
        for (let frame = node; frame; frame = frame.previousSibling)
          if (frame instanceof Ci.nsIDOMHTMLFrameElement || frame instanceof Ci.nsIDOMHTMLFrameSetElement)
            index++;

        let property = (hasCols ? "cols" : "rows");
        let weights = parentNode[property].split(",");
        weights[index] = "0";
        parentNode[property] = weights.join(",");
      }
    }
    else
      node.classList.add(collapsedClass);
  }
}
