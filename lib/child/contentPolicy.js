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

let {port} = require("messaging");
let {Utils} = require("utils");
let {getFrames, isPrivate, getRequestWindow} = require("child/utils");
let {objectMouseEventHander} = require("child/objectTabs");
let {RequestNotifier} = require("child/requestNotifier");

/**
 * Randomly generated class name, to be applied to collapsed nodes.
 * @type Promise.<string>
 */
let collapsedClass = port.emitWithResponse("getCollapsedClass");

/**
 * Maps numerical content type IDs to strings.
 * @type Map.<number,string>
 */
let types = new Map();

/**
 * Contains nodes stored by storeNodes() mapped by their IDs.
 * @type Map.<string,DOMNode[]>
 */
let storedNodes = new Map();

/**
 * Process-dependent prefix to be used for unique nodes identifiers returned
 * by storeNodes().
 * @type string
 */
let nodesIDPrefix = Services.appinfo.processID + " ";

/**
 * Counter used to generate unique nodes identifiers in storeNodes().
 * @type number
 */
let maxNodesID = 0;

port.on("deleteNodes", onDeleteNodes);
port.on("refilterNodes", onRefilterNodes);

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
  for (let hit of hits)
  {
    if (hit.contentType == "OBJECT")
      isObject = true;

    let context = node;
    if (typeof hit.frameIndex == "number")
    {
      context = window;
      for (let i = 0; i < hit.frameIndex; i++)
        context = context.parent;
      context = context.document;
    }
    RequestNotifier.addNodeData(context, window.top, hit);
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
  return processPolicyResponse(window, node, port.emitSync("shouldAllow", {
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
  port.emitWithResponse("shouldAllow", {
    contentType,
    location,
    frames: getFrames(window),
    isPrivate: isPrivate(window)
  }).then(response =>
  {
    callback(processPolicyResponse(window, node, response));
  });
};

/**
 * Stores nodes and generates a unique ID for them that can be used for
 * Policy.refilterNodes() later. It's important that Policy.deleteNodes() is
 * called later, otherwise the nodes will be leaked.
 * @param {DOMNode[]} nodes  list of nodes to be stored
 * @return {string}  unique ID for the nodes
 */
let storeNodes = exports.storeNodes = function(nodes)
{
  let id = nodesIDPrefix + (++maxNodesID);
  storedNodes.set(id, nodes);
  return id;
};

/**
 * Called via message whenever Policy.deleteNodes() is called in the parent.
 */
function onDeleteNodes(id, sender)
{
  storedNodes.delete(id);
}

/**
 * Called via message whenever Policy.refilterNodes() is called in the parent.
 */
function onRefilterNodes({nodesID, entry}, sender)
{
  let nodes = storedNodes.get(nodesID);
  if (nodes)
    for (let node of nodes)
      if (node.nodeType == Ci.nsIDOMNode.ELEMENT_NODE)
        Utils.runAsync(refilterNode.bind(this, node, entry));
}

/**
 * Re-checks filters on an element.
 */
function refilterNode(/**Node*/ node, /**Object*/ entry)
{
  let wnd = Utils.getWindow(node);
  if (!wnd || wnd.closed)
    return;

  if (entry.type == "OBJECT")
  {
    node.removeEventListener("mouseover", objectMouseEventHander, true);
    node.removeEventListener("mouseout", objectMouseEventHander, true);
  }

  shouldAllow(wnd, node, entry.type, entry.location, (allow) => {
    // Force node to be collapsed
    if (!allow)
      schedulePostProcess(node)
  });
}

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
    for (let category of this.xpcom_categories)
      catMan.addCategoryEntry(category, this.contractID, this.contractID, false, true);

    Services.obs.addObserver(this, "document-element-inserted", true);

    onShutdown.add(() =>
    {
      Services.obs.removeObserver(this, "document-element-inserted");

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

    // Bail out early for chrome: an resource: URLs, this is a work-around for
    // https://bugzil.la/1127744 and https://bugzil.la/1247640
    let location = Utils.unwrapURL(contentLocation);
    if (location.schemeIs("chrome") || location.schemeIs("resource"))
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
  _openers: new WeakMap(),
  _alreadyLoaded: Symbol(),

  observe: function(subject, topic, data, uri)
  {
    switch (topic)
    {
      case "document-element-inserted":
      {
        let window = subject.defaultView;
        if (!window)
          return;

        let type = window.QueryInterface(Ci.nsIInterfaceRequestor)
                         .getInterface(Ci.nsIWebNavigation)
                         .QueryInterface(Ci.nsIDocShellTreeItem)
                         .itemType;
        if (type != Ci.nsIDocShellTreeItem.typeContent)
          return;

        let opener = this._openers.get(window);
        if (opener == this._alreadyLoaded)
        {
          // This window has loaded already, ignore it regardless of whether
          // window.opener is still set.
          return;
        }

        if (opener && Cu.isDeadWrapper(opener))
          opener = null;

        if (!opener)
        {
          // We don't know the opener for this window yet, try to find it
          opener = window.opener;
          if (!opener)
            return;

          // The opener might be an intermediate window, get the real one
          while (opener.location == "about:blank" && opener.opener)
            opener = opener.opener;

          this._openers.set(window, opener);

          let forgetPopup = event =>
          {
            subject.removeEventListener("DOMContentLoaded", forgetPopup);
            this._openers.set(window, this._alreadyLoaded);
          };
          subject.addEventListener("DOMContentLoaded", forgetPopup);
        }

        if (!uri)
          uri = window.location.href;
        if (!shouldAllow(opener, opener.document, "POPUP", uri))
        {
          window.stop();
          Utils.runAsync(() => window.close());
        }
        else if (uri == "about:blank")
        {
          // An about:blank pop-up most likely means that a load will be
          // initiated asynchronously. Wait for that.
          Utils.runAsync(() =>
          {
            let channel = window.QueryInterface(Ci.nsIInterfaceRequestor)
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

      let wnd = getRequestWindow(newChannel);
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
          this.observe(wnd.document, "document-element-inserted", null, oldChannel.URI.spec);
          this.observe(wnd.document, "document-element-inserted", null, newChannel.URI.spec);
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
  collapsedClass.then(cls =>
  {
    let nodes = scheduledNodes;
    scheduledNodes = null;

    // Resolving class is async initially so the nodes might have already been
    // processed in the meantime.
    if (!nodes)
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
        node.classList.add(cls);
    }
  });
}
