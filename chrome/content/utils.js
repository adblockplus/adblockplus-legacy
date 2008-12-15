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
 * Portions created by the Initial Developer are Copyright (C) 2006-2008
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

/*
 * Utility functions and classes.
 * This file is included from nsAdblockPlus.js.
 */

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
  if (!(url instanceof Components.interfaces.nsIURI))
    url = makeURL(url);

  try
  {
    switch (url.scheme)
    {
      case "view-source":
        return unwrapURL(url.path);
      case "wyciwyg":
        return unwrapURL(url.path.replace(/^\/\/\d+\//, ""));
      case "jar":
        return unwrapURL(url.QueryInterface(Components.interfaces.nsIJARURI).JARFile);
      default:
        return url;
    }
  }
  catch (e) { return url; }
}
abp.unwrapURL = unwrapURL;

// Returns an nsIURI for given url
function makeURL(url) {
  try
  {
    return ioService.newURI(url, null, null);
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
  if (parentNode && parentNode instanceof Components.interfaces.nsIDOMHTMLFrameSetElement)
  {
    let hasCols = (parentNode.cols && parentNode.cols.indexOf(",") > 0);
    let hasRows = (parentNode.rows && parentNode.rows.indexOf(",") > 0);
    if ((hasCols || hasRows) && !(hasCols && hasRows))
    {
      var index = -1;
      for (var frame = node; frame; frame = frame.previousSibling)
        if (frame instanceof Components.interfaces.nsIDOMHTMLFrameElement || frame instanceof Components.interfaces.nsIDOMHTMLFrameSetElement)
          index++;
  
      var property = (hasCols ? "cols" : "rows");
      var weights = parentNode[property].split(",");
      weights[index] = "0";
      parentNode[property] = weights.join(",");
    }
  }
  else
    node.style.display = "none";
}

// Generates a click handler for object tabs
function generateClickHandler(wnd, data) {
  return function(event) {
    event.preventDefault();
    wnd.openDialog("chrome://adblockplus/content/composer.xul", "_blank", "chrome,centerscreen,resizable,dialog=no,dependent", wnd, data); 
  }
}

var objTabBinding = null;

// Creates a tab above/below the new object node
function addObjectTab(wnd, node, data, tab) {
  var origNode = node;

  if (node.parentNode && node.parentNode.tagName.toLowerCase() == "object") {
    // Don't insert object tabs inside an outer object, causes ActiveX Plugin to do bad things
    node = node.parentNode;
  }

  if (!node.parentNode || !node.offsetWidth || !node.offsetHeight)
    return;

  // Decide whether to display the tab on top or the bottom of the object
  var offsetTop = 0;
  for (var offsetNode = origNode; offsetNode; offsetNode = offsetNode.offsetParent)
    offsetTop += offsetNode.offsetTop;

  var onTop = (offsetTop > 40);

  // Click event handler
  tab.setAttribute("href", data.location);
  tab.addEventListener("click", generateClickHandler(wnd, data), false);

  // Insert tab into the document
  if (node.nextSibling)
    node.parentNode.insertBefore(tab, node.nextSibling);
  else
    node.parentNode.appendChild(tab);

  // Attach binding
  var doc = node.ownerDocument;
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
    if ("getBoundingClientRect" in origNode)
    {
      let nodeRect = origNode.getBoundingClientRect();
      let tabRect = tab.getBoundingClientRect();
      tab.style.setProperty("left", (nodeRect.right - tabRect.left) + "px", "important");
      tab.style.setProperty("top", ((onTop ? nodeRect.top : nodeRect.bottom) - tabRect.top) + "px", "important");
    }
    else
    {
      // Firefox 2 fallback code
      let box1 = doc.getBoxObjectFor(origNode);
      let box2 = doc.getBoxObjectFor(tab);
      tab.style.setProperty("left", (box1.screenX + box1.width - box2.screenX) + "px", "important");
      tab.style.setProperty("top", (box1.screenY + (onTop ? 0 : box1.height) - box2.screenY) + "px", "important");
    }

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
  else if (Filter.elemhideRegExp.test(text)) {
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

/**
 * Generates filter subscription checksum.
 *
 * @param {Array of String} lines filter subscription lines (with checksum line removed)
 * @return {String} checksum or null
 */
function generateChecksum(lines)
{
  let stream = null;
  try
  {
    // Checksum is an MD5 checksum (base64-encoded without the trailing "=") of
    // all lines in UTF-8 without the checksum line, joined with "\n".

    let converter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"]
                              .createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
    converter.charset = "UTF-8";
    stream = converter.convertToInputStream(lines.join("\n"));

    let hashEngine = Components.classes["@mozilla.org/security/hash;1"]
                               .createInstance(Components.interfaces.nsICryptoHash);
    hashEngine.init(hashEngine.MD5);
    hashEngine.updateFromStream(stream, stream.available());
    return hashEngine.finish(true).replace(/=+$/, "");
  }
  catch (e)
  {
    return null;
  }
  finally
  {
    if (stream)
      stream.close();
  }
}
abp.generateChecksum = generateChecksum;
