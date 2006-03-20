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
 * Portions created by the Initial Developer are Copyright (C) 2006
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
  this.data = {};
}
HashTable.prototype = {
  get: function(key) {
    key = " " + key;
    if (key in this.data)
      return this.data[key];
    else
      return undefined;
  },
  put: function(key, value) {
    key = " " + key;
    this.data[key] = value;
  },
  remove: function(key) {
    key = " " + key;
    delete this.data[key];
  },
  has: function(key) {
    key = " " + key;
    return (key in this.data);
  },
  clear: function() {
    this.data = {};
  },
  keys: function() {
    var result = [];
    for (var key in this.data)
      if (key.indexOf(" ") == 0)
        result.push(key.substr(1));

    return result;
  },
  values: function() {
    var result = [];
    for (var key in this.data)
      if (key.indexOf(" ") == 0)
        result.push(this.data[key]);

    return result;
  }
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
function getWindow(insecNode) {
  if (insecNode instanceof Window)
    return insecNode;

  if (secureGet(insecNode, "nodeType") != Node.DOCUMENT_NODE)
    insecNode = secureGet(insecNode, "ownerDocument");

  if (!insecNode || secureGet(insecNode, "nodeType") != Node.DOCUMENT_NODE)
    return null;

  return secureGet(insecNode, "defaultView");
}

// hides a blocked element and collapses it if necessary
function hideNode(insecNode, insecWnd, collapse) {
  // special handling for applets -- disable by specifying the Applet base class
  var nodeName = secureGet(insecNode, "nodeName");
  if (nodeName && nodeName.toLowerCase() == "applet")
    secureLookup(insecNode, "setAttribute")("code", "java.applet.Applet");

  // Empty frames to avoid a graphics glitch -- old api only
  if (oldStyleAPI && insecNode instanceof Window) {
    var insecRoot = secureGet(insecNode, "document", "documentElement");
    var removeFunc = secureLookup(insecRoot, "removeChild");
    var insecChild;
    while ((insecChild = secureGet(insecRoot, "firstChild")) != null)
      removeFunc(insecChild);
  }

  if (collapse) {
    if (insecNode instanceof Window)
      insecNode = secureGet(insecNode, "frameElement");

    // adjust frameset's cols/rows for frames
    var attrFunc = secureLookup(insecNode, "parentNode", "hasAttribute");
    var parentNode = secureGet(insecNode, "parentNode");
    if (attrFunc && secureGet(parentNode, "nodeName").toLowerCase() == "frameset" &&
        (attrFunc("cols") ^ attrFunc("rows"))) {
      var frameTags = {FRAME: true, FRAMESET: true};
      var index = -1;
      for (var insecFrame = insecNode; insecFrame; insecFrame = secureGet(insecFrame, "previousSibling"))
        if (secureGet(insecFrame, "nodeName").toUpperCase() in frameTags)
          index++;
  
      var attr = (attrFunc("rows") ? "rows" : "cols");
      secureLookup(insecWnd, "setTimeout")(hideFrameCallback, 0, parentNode, attr, index);
    }
    else
      secureLookup(insecWnd, "setTimeout")(hideCallback, 0, insecNode);
  }
}

function hideCallback(insecNode) {
  secureSet(insecNode, "style", "display", "none");
}

function hideFrameCallback(insecFrameset, attr, index) {
  var weights = secureLookup(insecFrameset, "getAttribute")(attr).split(",");
  weights[index] = "0";
  secureLookup(insecFrameset, "setAttribute")(attr, weights.join(","));
}

// Returns the visible area of an element, coordinates relative to the upper-left corner of the page
function getElementRect(insecNode) {
  var insecWnd = secureGet(insecNode, "ownerDocument", "defaultView");
  var boxFunc = secureLookup(insecNode, "ownerDocument", "getBoxObjectFor");
  if (!insecWnd || !boxFunc)
    return null;

  var styleFunc = secureLookup(insecWnd, "getComputedStyle");
  if (!styleFunc)
    return null;

  var insecBox = boxFunc(insecNode);
  var rect = [
    secureGet(insecBox, "x"),
    secureGet(insecBox, "y"),
    secureGet(insecNode, "clientWidth") || secureGet(insecBox, "width"),
    secureGet(insecNode, "clientHeight") || secureGet(insecBox, "height")
  ];

  while (insecNode != secureGet(insecBox, "parentBox")) {
    insecNode = secureGet(insecBox, "parentBox");
    if (!insecNode)
      break;

    insecBox = boxFunc(insecNode);

    // Account for parent's scrolling
    rect[0] -= secureGet(insecNode, "scrollLeft");
    rect[1] -= secureGet(insecNode, "scrollTop");

    if (styleFunc(insecNode, "").overflow != "visible") {
      // Adjust coordinates to the visible area of the parent
      var px = secureGet(insecBox, "x");
      var py = secureGet(insecBox, "y");
      if (rect[0] < px) {
        rect[2] -= px - rect[0];
        rect[0] = px;
      }
      if (rect[1] < py) {
        rect[3] -= py - rect[1];
        rect[1] = py;
      }
      if (rect[0] + rect[2] > px + secureGet(insecNode, "clientWidth"))
        rect[2] = px + secureGet(insecNode, "clientWidth") - rect[0];
      if (rect[1] + rect[3] > py + secureGet(insecNode, "clientHeight"))
        rect[3] = py + secureGet(insecNode, "clientHeight") - rect[1];

      if (rect[2] <= 0 || rect[3] <= 0)
        return null;
    }
  }

  return rect;
}

// Called on mousemove - checks whether any object tabs should be shown
function checkObjectTabs(e) {
  doCheckObjectTabs(this, e.clientX, e.clientY);
}

function doCheckObjectTabs(insecWnd, x, y) {
  if (prefs.objtabs_timeout <= 0)
    return;

  var data = DataContainer.getDataForWindow(insecWnd).getAllLocations(undefined, true);
  for (var i = 0; i < data.length; i++) {
    if (data[i].type != type.OBJECT || data[i].filter)
      continue;

    for (var j = 0; j < data[i].inseclNodes.length; j++) {
      var rect = getElementRect(data[i].inseclNodes[j]);
      if (rect && x >= rect[0] - prefs.objtabs_threshold && y >= rect[1] - prefs.objtabs_threshold &&
          x < rect[0] + rect[2] + prefs.objtabs_threshold && y < rect[1] + rect[3] + prefs.objtabs_threshold)
        showObjectTab(insecWnd, data[i].inseclNodes[j], data[i].location, rect);
    }
  }

  // Check child frames recursively
  var numFrames = secureGet(insecWnd, "frames", "length");
  for (i = 0; i < numFrames; i++) {
    var insecFrame = secureGet(insecWnd, "frames")[i];
    var insecFrameElement = secureGet(insecFrame, "frameElement");

    rect = getElementRect(insecFrameElement);
    if (rect && x >= rect[0] - prefs.objtabs_threshold && y >= rect[1] - prefs.objtabs_threshold &&
        x < rect[0] + rect[2] + prefs.objtabs_threshold && y < rect[1] + rect[3] + prefs.objtabs_threshold)
      doCheckObjectTabs(insecFrame, x - rect[0], y - rect[1]);
  }
}

// Shows object tab at an object
var showingObjectTabs = [];
function showObjectTab(insecWnd, insecNode, location, rect) {
  var insecDoc = secureGet(insecNode, "ownerDocument");
  if (!insecDoc)
    return;

  // Make sure we don't show an object tab if we are already showing one
  var timestamp = new Date().getTime();
  for (var i = 0; i < showingObjectTabs.length; i++) {
    if (timestamp - showingObjectTabs[i][1] > prefs.objtabs_timeout)
      showingObjectTabs.splice(i--, 1);
    else if (showingObjectTabs[i][0] == insecNode)
      return;
  }

  var x = (rect[0] < 0 ? 0 : rect[0]) + 5;
  var y = (rect[1] < 0 ? 0 : rect[1]) + 5;

  var label = secureLookup(insecDoc, "createElementNS")("http://www.w3.org/1999/xhtml", "div");
  label.appendChild(secureLookup(insecDoc, "createTextNode")("Adblock"));
  label.style.display = "block";
  label.style.position = "fixed";
  label.style.left = x + "px";
  label.style.top = y + "px";
  label.style.width = "auto";
  label.style.height = "auto";
  label.style.overflow = "visible";
  label.style.borderStyle = "ridge";
  label.style.borderWidth = "2px";
  label.style.padding = "2px";
  label.style.margin = "0px";
  label.style.backgroundColor = "white";
  label.style.color = "black";
  label.style.cursor = "pointer";
  label.style.fontFamily = "Arial,Helvetica,Sans-serif";
  label.style.fontSize = "12px";
  label.style.fontStyle = "normal";
  label.style.fontVariant = "normal";
  label.style.fontWeight = "normal";
  label.style.letterSpacing = "normal";
  label.style.lineHeight = "normal";
  label.style.textAlign = "center";
  label.style.textDecoration = "none";
  label.style.textIndent = "0px";
  label.style.textTransform = "none";
  label.style.direction = "ltr";
  label.style.zIndex = 2147483647;
  label.style.MozOpacity = "1";

  label.addEventListener("click", function() {
    abp.openSettingsDialog(insecWnd, location);
  }, false);

  secureLookup(insecDoc, "documentElement", "appendChild")(label);

  secureLookup(insecWnd, "setTimeout")(hideObjectTab, prefs.objtabs_timeout, label);

  showingObjectTabs.push([insecNode, timestamp, label]);
}

// Hides object tab
function hideObjectTab(insecNode) {
  var insecParent = secureGet(insecNode, "parentNode");
  if (insecParent)
    secureLookup(insecParent, "removeChild")(insecNode);
}

// Hides all object tabs that are displayed at the moment
function hideAllObjectTabs() {
  for (var i = 0; i < showingObjectTabs.length; i++)
    hideObjectTab(showingObjectTabs[i][2]);

  showingObjectTabs = [];
}
abp.hideAllObjectTabs = hideAllObjectTabs;

// Sets a timeout, compatible with both nsITimer and nsIScriptableTimer
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
