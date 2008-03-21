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
 * Wladimir Palant.
 * Portions created by the Initial Developer are Copyright (C) 2006-2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

/*
 * Utility functions and classes.
 * This file is included from nsAdblockPlus.js.
 */

// A hash table class - sort of
function HashTable() {
  this.__proto__ = null;
}
abp.HashTable = HashTable;

// String service
var stringService = Components.classes["@mozilla.org/intl/stringbundle;1"]
                              .getService(Components.interfaces.nsIStringBundleService);
var strings = stringService.createBundle("chrome://adblockplus/locale/global.properties");
abp.getString = function(name) {
  return strings.GetStringFromName(name);
};

// Retrieves the window object for a node or returns null if it isn't possible
function getWindow(node) {
  if (node && node.nodeType != Node.DOCUMENT_NODE)
    node = node.ownerDocument;

  if (!node || node.nodeType != Node.DOCUMENT_NODE)
    return null;

  return node.defaultView;
}

// Unwraps jar:, view-source: and wyciwyg: URLs, returns the contained URL
function unwrapURL(url) {
  if (!url)
    return url;

  var ret = url.replace(/^view-source:/).replace(/^wyciwyg:\/\/\d+\//);
  if (/^jar:(.*?)!/.test(ret))
    ret = RegExp.$1;

  if (ret == url)
    return url;
  else
    return unwrapURL(ret);
}
abp.unwrapURL = unwrapURL;

// Creates a nsISimpleURI with given url
function makeURL(url) {
  var ret = Components.classes["@mozilla.org/network/standard-url;1"]
                      .createInstance(Components.interfaces.nsIURL);
  try {
    ret.spec = url;
    return ret;
  }
  catch (e) {
    return null;
  }
}
abp.makeURL = makeURL;

// hides a blocked element and collapses it if necessary
function postProcessNode(node) {
  if (!(node instanceof Element))
    return;

  // adjust frameset's cols/rows for frames
  var parentNode = node.parentNode;
  if (parentNode && parentNode.nodeName.toLowerCase() == "frameset") {
    var nonEmptyRE = /,/;
    var hasCols = parentNode.hasAttribute("cols") && nonEmptyRE.test(parentNode.getAttribute("cols"));
    var hasRows = parentNode.hasAttribute("rows") && nonEmptyRE.test(parentNode.getAttribute("rows"));
    if (hasCols ^ hasRows) {
      var frameTags = {FRAME: true, FRAMESET: true};
      var index = -1;
      for (var frame = node; frame; frame = frame.previousSibling)
        if (frame.nodeName.toUpperCase() in frameTags)
          index++;
  
      var attr = (hasRows ? "rows" : "cols");
      var weights = parentNode.getAttribute(attr).split(",");
      weights[index] = "0";
      parentNode.setAttribute(attr, weights.join(","));
    }
  }
  else
    node.style.display = "none";
}

function setElementHidingException(wnd, seed) {
  wnd.document.documentElement.setAttribute("abpWhitelist" + seed, "");
}

// Returns the visible area of an element, coordinates relative to the upper-left corner of the page
function getElementRect(node) {
  if (!node.ownerDocument || !node.ownerDocument.defaultView)
    return null;

  var doc = node.ownerDocument;
  var wnd = doc.defaultView;

  var box = doc.getBoxObjectFor(node);
  var rect = [
    box.x,
    box.y,
    node.clientWidth || box.width,
    node.clientHeight || box.height
  ];

  while (node != box.parentBox) {
    node = box.parentBox;
    if (!node)
      break;

    box = doc.getBoxObjectFor(node);

    // Account for parent's scrolling
    rect[0] -= node.scrollLeft;
    rect[1] -= node.scrollTop;

    if (wnd.getComputedStyle(node, "").overflow != "visible") {
      // Adjust coordinates to the visible area of the parent
      var px = box.x;
      var py = box.y;
      if (rect[0] < px) {
        rect[2] -= px - rect[0];
        rect[0] = px;
      }
      if (rect[1] < py) {
        rect[3] -= py - rect[1];
        rect[1] = py;
      }
      if (rect[0] + rect[2] > px + node.clientWidth)
        rect[2] = px + node.clientWidth - rect[0];
      if (rect[1] + rect[3] > py + node.clientHeight)
        rect[3] = py + node.clientHeight - rect[1];

      if (rect[2] <= 0 || rect[3] <= 0)
        return null;
    }
  }

  return rect;
}

// Generates a click handler for object tabs
function generateClickHandler(wnd, location) {
  return function(event) {
    event.preventDefault();
    abp.openSettingsDialog(wnd, location);
  }
}

var objTabBinding = null;

// Creates a tab above/below the new object node
function addObjectTab(node, location, tab, wnd) {
  var origNode = node;

  if (node.parentNode && node.parentNode.tagName.toLowerCase() == "object") {
    // Don't insert object tabs inside an outer object, causes ActiveX Plugin to do bad things
    node = node.parentNode;
  }

  if (!node.parentNode)
    return;

  // Decide whether to display the tab on top or the bottom of the object
  var offsetTop = 0;
  for (var offsetNode = origNode; offsetNode; offsetNode = offsetNode.offsetParent)
    offsetTop += offsetNode.offsetTop;

  var onTop = (offsetTop > 40);

  // Click event handler
  tab.setAttribute("href", location);
  tab.addEventListener("click", generateClickHandler(wnd, location), false);

  // Insert tab into the document
  node.parentNode.insertBefore(tab, node);

  // Attach binding
  var doc = node.ownerDocument;
  abp.allowOnce("chrome://adblockplus/content/objecttab.xml#objectTab");
  doc.loadBindingDocument("chrome://adblockplus/content/objecttab.xml");
  doc.addBinding(tab, "chrome://adblockplus/content/objecttab.xml#objectTab");

  var initHandler = function() {
    // Make binding apply properly
    tab.className = gObjtabClass;

    createTimer(initHandler2, 0);
  }
  var initHandler2 = function() {
    // Initialization
    var label = doc.getAnonymousNodes(tab)[0];

    // Tooltip
    tab.setAttribute("title", label.getAttribute("title"));

    // Tab dimensions
    var tabWidth = label.offsetWidth;
    var tabHeight = label.offsetHeight;

    // Label positioning
    label.style.setProperty("left", -tabWidth + "px", "important");
    label.style.setProperty("top", onTop ? -tabHeight + "px" :  "0px", "important");

    // Tab positioning
    var box1 = doc.getBoxObjectFor(origNode);
    var box2 = doc.getBoxObjectFor(tab);
    tab.style.setProperty("left", (box1.screenX + box1.width - box2.screenX) + "px", "important");
    tab.style.setProperty("top", (box1.screenY + (onTop ? 0 : box1.height) - box2.screenY) + "px", "important");

    // Show tab
    tab.className = gObjtabClass + " visible" + (onTop ? " ontop" : "");
  }
  createTimer(initHandler, 0);
}

// Sets a timeout, comparable to the usual setTimeout function
function createTimer(callback, delay) {
  var timer = Components.classes["@mozilla.org/timer;1"];
  timer = timer.createInstance(Components.interfaces.nsITimer);
  timer.init({observe: callback}, delay, timer.TYPE_ONE_SHOT);
  return timer;
}

// Returns plattform dependent line break string
var lineBreak = null;
function getLineBreak() {
  if (lineBreak == null) {
    // HACKHACK: Gecko doesn't expose NS_LINEBREAK, try to determine
    // plattform's line breaks by reading prefs.js
    lineBreak = "\n";
    try {
      var dirService = Components.classes["@mozilla.org/file/directory_service;1"]
                                  .createInstance(Components.interfaces.nsIProperties);
      var prefFile = dirService.get("PrefF", Components.interfaces.nsIFile);
      var inputStream = Components.classes["@mozilla.org/network/file-input-stream;1"]
                                  .createInstance(Components.interfaces.nsIFileInputStream);
      inputStream.init(prefFile, 0x01, 0444, 0);

      var scriptableStream = Components.classes["@mozilla.org/scriptableinputstream;1"]
                                        .createInstance(Components.interfaces.nsIScriptableInputStream);
      scriptableStream.init(inputStream);
      var data = scriptableStream.read(1024);
      scriptableStream.close();

      if (/(\r\n?|\n\r?)/.test(data))
        lineBreak = RegExp.$1;
    } catch (e) {}
  }
  return lineBreak;
}
abp.getLineBreak = getLineBreak;

// Removes unnecessary whitespaces from filter
function normalizeFilter(text) {
  if (!text)
    return text;

  // Remove line breaks and such
  text = text.replace(/[^\S ]/g, "");

  if (/^\s*!/.test(text)) {
    // Don't remove spaces inside comments
    return text.replace(/^\s+/, "").replace(/\s+$/, "");
  }
  else if (abp.elemhideRegExp.test(text)) {
    // Special treatment for element hiding filters, right side is allowed to contain spaces
    /^(.*?)(#+)(.*)$/.test(text);   // .split(..., 2) will cut off the end of the string
    var domain = RegExp.$1;
    var separator = RegExp.$2;
    var selector = RegExp.$3;
    return domain.replace(/\s/g, "") + separator + selector.replace(/^\s+/, "").replace(/\s+$/, "");
  }
  else
    return text.replace(/\s/g, "");
}
abp.normalizeFilter = normalizeFilter;

//HACKHACK: need a way to get an implicit wrapper for nodes because of bug 337095 (fixed in Gecko 1.8.0.5)
var fakeFactory = {
  createInstance: function(outer, iid) {
    return outer;
  },

  QueryInterface: function(iid) {
    if (iid.equals(Components.interfaces.nsISupports) ||
        iid.equals(Components.interfaces.nsIFactory))
      return this;

    throw Components.results.NS_ERROR_NO_INTERFACE;
  }
};
var array = Components.classes['@mozilla.org/supports-array;1'].createInstance(Components.interfaces.nsISupportsArray);
array.AppendElement(fakeFactory);
fakeFactory = array.GetElementAt(0).QueryInterface(Components.interfaces.nsIFactory);
array = null;

function wrapNode(insecNode) {
  return fakeFactory.createInstance(insecNode, Components.interfaces.nsISupports);
}
