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
 * Portions created by the Initial Developer are Copyright (C) 2006-2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

//
// Report data template, more data will be added during data collection
//

let reportData =
  <report>
    <adblock-plus version={Utils.addonVersion} build={Utils.addonBuild} locale={Utils.appLocale}/>
    <application name={Utils.appInfo.name} vendor={Utils.appInfo.vendor} version={Utils.appInfo.version} userAgent={window.navigator.userAgent}/>
    <platform name="Gecko" version={Utils.appInfo.platformVersion} build={Utils.appInfo.platformBuildID}/>
    <options>
      <option id="enabled">{Prefs.enabled}</option>
      <option id="objecttabs">{Prefs.frameobjects}</option>
      <option id="collapse">{!Prefs.fastcollapse}</option>
      <option id="privateBrowsing">{Prefs.privateBrowsing}</option>
    </options>
    <window/>
    <requests/>
    <filters/>
    <subscriptions/>
    <errors/>
  </report>;

//
// Data collectors
//

let requestsDataSource =
{
  requests: reportData.requests,
  requestNotifier: null,
  callback: null,

  collectData: function(wnd, callback)
  {
    this.callback = callback;
    this.requestNotifier = new RequestNotifier(wnd, this.onRequestFound, this);
  },

  onRequestFound: function(frame, node, entry, scanComplete)
  {
    if (entry)
    {
      let requestXML = <request location={censorURL(entry.location)} type={entry.typeDescr}
                        docDomain={entry.docDomain} thirdParty={entry.thirdParty}/>;

      // Location is meaningless for element hiding hits
      if (entry.filter && entry.filter instanceof ElemHideFilter)
        delete requestXML.@location;  
        
      if (entry.filter)
        requestXML.@filter = entry.filter.text;

      if (node instanceof Element)
      {
        requestXML.@node = node.localName;
        if (node.namespaceURI)
          requestXML.@node = node.namespaceURI + "#" + requestXML.@node;

        try
        {
          requestXML.@size = node.offsetWidth + "x" + node.offsetHeight;
        } catch(e) {}
      }

      this.requests.appendChild(requestXML);
    }

    if (scanComplete)
    {
      this.requestNotifier.shutdown();
      this.requestNotifier = null;
      this.callback();
    }
  }
};

let filtersDataSource =
{
  collectData: function(wnd, callback)
  {
    let wndStats = RequestNotifier.getWindowStatistics(wnd);
    if (wndStats)
    {
      let filters = reportData.filters;
      for (let f in wndStats.filters)
      {
        let filter = Filter.fromText(f)
        let hitCount = wndStats.filters[f];
        filters.appendChild(<filter text={filter.text} subscriptions={filter.subscriptions.map(function(s) s.url).join(" ")} hitCount={hitCount}/>);
      }
    }
    callback();
  }
};

let subscriptionsDataSource =
{
  collectData: function(wnd, callback)
  {
    let subscriptions = reportData.subscriptions;
    let now = Math.round(Date.now() / 1000);
    for (let i = 0; i < FilterStorage.subscriptions.length; i++)
    {
      let subscription = FilterStorage.subscriptions[i];
      if (subscription.disabled || !(subscription instanceof RegularSubscription))
        continue;

      let subscriptionXML = <subscription id={subscription.url}/>;
      if (subscription.lastDownload)
        subscriptionXML.@lastDownloadAttempt = subscription.lastDownload - now;
      if (subscription instanceof DownloadableSubscription)
      {
        if (subscription.lastSuccess)
          subscriptionXML.@lastDownloadSuccess = subscription.lastSuccess - now;
        if (subscription.softExpiration)
          subscriptionXML.@softExpiration = subscription.softExpiration - now;
        if (subscription.expires)
          subscriptionXML.@hardExpiration = subscription.expires - now;
        subscriptionXML.@autoDownloadEnabled = subscription.autoDownload;
        subscriptionXML.@downloadStatus = subscription.downloadStatus;
      }
      subscriptions.appendChild(subscriptionXML);
    }
    callback();
  }
};

let screenshotDataSource =
{
  imageOffset: 10,

  // Fields used for color reduction
  _mapping: [0x00,  0x55,  0xAA,  0xFF],
  _i: null,
  _max: null,
  _pixelData: null,
  _callback: null,

  // Fields used for user interaction
  _enabled: true,
  _canvas: null,
  _context: null,
  _selectionType: "mark",
  _currentData: null,
  _undoQueue: [],

  collectData: function(wnd, callback)
  {
    this._callback = callback;
    this._canvas = E("screenshotCanvas");
    this._canvas.width = this._canvas.offsetWidth;
    this._context = this._canvas.getContext("2d");
    let wndWidth = wnd.document.documentElement.scrollWidth;
    let wndHeight = wnd.document.documentElement.scrollHeight;
  
    // Copy scaled screenshot of the webpage. We scale the webpage by width
    // but leave 10px on each side for easier selecting.
  
    // Gecko doesn't like sizes more than 64k, restrict to 30k to be on the safe side.
    // Also, make sure height is at most five times the width to keep image size down.
    let copyWidth = Math.min(wndWidth, 30000);
    let copyHeight = Math.min(wndHeight, 30000, copyWidth * 5);
    let copyX = Math.max(Math.min(wnd.scrollX - copyWidth / 2, wndWidth - copyWidth), 0);
    let copyY = Math.max(Math.min(wnd.scrollY - copyHeight / 2, wndHeight - copyHeight), 0);
  
    let scalingFactor = (this._canvas.width - this.imageOffset * 2) / copyWidth;
    this._canvas.height = copyHeight * scalingFactor + this.imageOffset * 2;
  
    this._context.save();
    this._context.translate(this.imageOffset, this.imageOffset);
    this._context.scale(scalingFactor, scalingFactor);
    this._context.drawWindow(wnd, copyX, copyY, copyWidth, copyHeight, "rgb(255,255,255)");
    this._context.restore();
  
    // Init canvas settings
    this._context.fillStyle = "rgb(0, 0, 0)";
    this._context.strokeStyle = "rgba(255, 0, 0, 0.7)";
    this._context.lineWidth = 3;
    this._context.lineJoin = "round";
  
    // Reduce colors asynchronously
    this._pixelData = this._context.getImageData(this.imageOffset, this.imageOffset,
                                      this._canvas.width - this.imageOffset * 2,
                                      this._canvas.height - this.imageOffset * 2);
    this._max = this._pixelData.width * this._pixelData.height * 4;
    this._i = 0;
    Utils.threadManager.currentThread.dispatch(this, Ci.nsIEventTarget.DISPATCH_NORMAL);
  },

  run: function()
  {
    // Process only 5000 bytes at a time to prevent browser hangs
    let endIndex = Math.min(this._i + 5000, this._max);
    let i = this._i;
    for (; i < endIndex; i++)
      this._pixelData.data[i] = this._mapping[this._pixelData.data[i] >> 6];

    if (i >= this._max)
    {
      // Save data back and we are done
      this._context.putImageData(this._pixelData, this.imageOffset, this.imageOffset);
      this._callback();
    }
    else
    {
      this._i = i;
      Utils.threadManager.currentThread.dispatch(this, Ci.nsIEventTarget.DISPATCH_NORMAL);
    }
  },

  get enabled() this._enabled,
  set enabled(enabled)
  {
    if (this._enabled == enabled)
      return;

    this._enabled = enabled;
    this._canvas.style.opacity = this._enabled ? "" : "0.3"
    E("screenshotMarkButton").disabled = !this._enabled;
    E("screenshotRemoveButton").disabled = !this._enabled;
    E("screenshotUndoButton").disabled = !this._enabled || !this._undoQueue.length;
  },

  get selectionType() this._selectionType,
  set selectionType(type)
  {
    if (this._selectionType == type)
      return;
  
    // Abort selection already in progress
    this.abortSelection();
  
    this._selectionType = type;
  },
  
  exportData: function()
  {
    if (this.enabled)
      reportData.screenshot = this._canvas.toDataURL();
    else
      delete reportData.screenshot;
  },

  abortSelection: function()
  {
    if (this._currentData && this._currentData.data)
    {
      this._context.putImageData(this._currentData.data,
        Math.min(this._currentData.anchorX, this._currentData.currentX),
        Math.min(this._currentData.anchorY, this._currentData.currentY));
    }
    document.removeEventListener("keypress", this.handleKeyPress, true);
    this._currentData = null;
  },

  handleKeyPress: function(event)
  {
    if (event.keyCode == Ci.nsIDOMKeyEvent.DOM_VK_ESCAPE)
    {
      event.stopPropagation();
      event.preventDefault();
      screenshotDataSource.abortSelection();
    }
  },
  
  startSelection: function(event)
  {
    if (event.button == 2)
      this.abortSelection();   // Right mouse button aborts selection
  
    if (event.button != 0 || !this.enabled)
      return;
  
    // Abort selection already in progress
    this.abortSelection();
  
    this._currentData = {
      data: null,
      anchorX: event.layerX,
      anchorY: event.layerY,
      currentX: -1,
      currentY: -1
    };
    this.updateSelection(event);
  
    document.addEventListener("keypress", this.handleKeyPress, true);
  },
  
  updateSelection: function(event)
  {
    if (event.button != 0 || !this._currentData)
      return;
  
    if (this._currentData.currentX == event.layerX && this._currentData.currentY == event.layerY)
      return;
  
    if (this._currentData.data)
    {
      this._context.putImageData(this._currentData.data,
        Math.min(this._currentData.anchorX, this._currentData.currentX),
        Math.min(this._currentData.anchorY, this._currentData.currentY));
    }
  
    this._currentData.currentX = event.layerX;
    this._currentData.currentY = event.layerY;
  
    let left = Math.min(this._currentData.anchorX, this._currentData.currentX);
    let right = Math.max(this._currentData.anchorX, this._currentData.currentX);
    let top = Math.min(this._currentData.anchorY, this._currentData.currentY);
    let bottom = Math.max(this._currentData.anchorY, this._currentData.currentY);
  
    let minDiff = (this._selectionType == "mark" ? 3 : 1);
    if (right - left >= minDiff && bottom - top >= minDiff)
      this._currentData.data = this._context.getImageData(left, top, right - left, bottom - top);
    else
      this._currentData.data = null;
  
    if (this._selectionType == "mark")
    {
      // all coordinates need to be moved 1.5px inwards to get the desired result
      left += 1.5;
      right -= 1.5;
      top += 1.5;
      bottom -= 1.5;
      if (left < right && top < bottom)
        this._context.strokeRect(left, top, right - left, bottom - top);
    }
    else if (this._selectionType == "remove")
      this._context.fillRect(left, top, right - left, bottom - top);
  },
  
  stopSelection: function(event)
  {
    if (event.button != 0 || !this._currentData)
      return;
  
    if (this._currentData.data)
    {
      this._undoQueue.push(this._currentData);
      E("screenshotUndoButton").disabled = false;
    }
  
    this._currentData = null;
    document.removeEventListener("keypress", this.handleKeyPress, true);
  },
  
  undo: function()
  {
    let op = this._undoQueue.pop();
    if (!op)
      return;
  
    this._context.putImageData(op.data,
      Math.min(op.anchorX, op.currentX),
      Math.min(op.anchorY, op.currentY));
  
    if (!this._undoQueue.length)
      E("screenshotUndoButton").disabled = true;
  }
};

let framesDataSource =
{
  collectData: function(wnd, callback)
  {
    reportData.window.@url = censorURL(wnd.location.href);
    this.scanFrames(wnd, reportData.window);

    callback();
  },

  scanFrames: function(wnd, xmlList)
  {
    try
    {
      for (let i = 0; i < wnd.frames.length; i++)
      {
        let frame = wnd.frames[i];
        let frameXML = <frame url={censorURL(frame.location.href)}/>;
        this.scanFrames(frame, frameXML);
        xmlList.appendChild(frameXML);
      }
    }
    catch (e)
    {
      // Don't break if something goes wrong
      Cu.reportError(e);
    }
  }
};

let errorsDataSource =
{
  collectData: function(wnd, callback)
  {
    let messages = {};
    Cc["@mozilla.org/consoleservice;1"].getService(Ci.nsIConsoleService).getMessageArray(messages, {});
    messages = messages.value || [];
    messages = messages.filter(function(message)
    {
      return (message instanceof Ci.nsIScriptError &&
          !/^https?:/i.test(message.sourceName) &&
          (/adblock/i.test(message.errorMessage) || /adblock/i.test(message.sourceName)));
    });
    if (messages.length > 10)   // Only the last 10 messages
      messages = messages.slice(messages.length - 10, messages.length);
  
    // Censor app and profile paths in error messages
    let censored = {__proto__: null};
    let pathList = [["ProfD", "%PROFILE%"], ["GreD", "%GRE%"], ["CurProcD", "%APP%"]];
    for (let i = 0; i < pathList.length; i++)
    {
      let [pathID, placeholder] = pathList[i];
      try
      {
        let file = Utils.dirService.get(pathID, Ci.nsIFile);
        censored[file.path.replace(/[\\\/]+$/, '')] = placeholder;
        let uri = Utils.ioService.newFileURI(file);
        censored[uri.spec.replace(/[\\\/]+$/, '')] = placeholder;
      } catch(e) {}
    }
  
    let errors = reportData.errors;
    for (let i = 0; i < messages.length; i++)
    {
      let message = messages[i];
  
      let text = message.errorMessage;
      for (let path in censored)
        text = text.replace(path, censored[path], "gi");
      if (text.length > 256)
        text = text.substr(0, 256) + "...";
  
      let file = message.sourceName;
      for (let path in censored)
        file = file.replace(path, censored[path], "gi");
      if (file.length > 256)
        file = file.substr(0, 256) + "...";
  
      let sourceLine = message.sourceLine;
      if (sourceLine.length > 256)
        sourceLine = sourceLine.substr(0, 256) + "...";
  
      let errorXML = <error type={message.flags & Ci.nsIScriptError.warningFlag ? "warning" : "error"}
                            text={text} file={file} line={message.lineNumber} column={message.columnNumber} sourceLine={sourceLine}/>;
      errors.appendChild(errorXML);
    }

    callback();
  }
};

let dataCollectors = [requestsDataSource, filtersDataSource, subscriptionsDataSource,
                      screenshotDataSource, framesDataSource, errorsDataSource];

//
// Wizard logic
//

function initWizard()
{
  // Make sure no issue type is selected by default
  E("typeGroup").selectedItem = null;
  document.documentElement.addEventListener("pageshow", updateNextButton, false);
}

function updateNextButton()
{
  let nextButton = document.documentElement.getButton("next");
  if (!nextButton)
    return;

  if (document.documentElement.currentPage.id == "commentPage")
  {
    if (!nextButton.hasAttribute("_origLabel"))
    {
      nextButton.setAttribute("_origLabel", nextButton.getAttribute("label"));
      nextButton.setAttribute("label", document.documentElement.getAttribute("sendbuttonlabel"));
    }
  }
  else
  {
    if (nextButton.hasAttribute("_origLabel"))
    {
      nextButton.setAttribute("label", nextButton.getAttribute("_origLabel"));
      nextButton.removeAttribute("_origLabel");
    }
  }
}

function initDataCollectorPage()
{
  document.documentElement.canAdvance = false;

  let contentWindow = window.arguments[0];
  let initNextDataSource = function()
  {
    if (!dataCollectors.length)
    {
      // We are done, continue to next page
      document.documentElement.canAdvance = true;
      document.documentElement.advance();
      return;
    }

    let dataSource = dataCollectors.shift();
    dataSource.collectData(contentWindow, initNextDataSource);
  };

  initNextDataSource();
}

function setProgress(index)
{
  let header = document.getAnonymousElementByAttribute(document.documentElement, "class", "wizard-header");
  if (!header)
    return;   // Oops

  header.setAttribute("textColor", window.getComputedStyle(header, "").color);
  for (let i = 1; i <= 4; i++)
  {
    let classes = [];
    if (i < index)
      classes.push("done");
    else
      classes.push("outstanding");
    if (i == index)
      classes.push("active");
    header.setAttribute("label" + i + "Class", classes.join(" "));
  }
  header.setAttribute("viewIndex", "1");
}

function initTypeSelectorPage()
{
  setProgress(1);

  document.documentElement.canRewind = false;
  typeSelectionUpdated();
}

function typeSelectionUpdated()
{
  let selection = E("typeGroup").selectedItem;
  document.documentElement.canAdvance = (selection != null);
  if (selection)
    reportData.@type = selection.value;
}

function initScreenshotPage()
{
  setProgress(2);
}

function initCommentPage()
{
  setProgress(3);

  screenshotDataSource.exportData();

  let dataField = E("data");
  dataField.value = reportData.toXMLString();
  dataField.setSelectionRange(0, 0);
}

function checkCommentLength()
{
  let value = E("comment").value;
  E("commentLengthWarning").setAttribute("visible", value.length > 1000);
}

function initSendPage()
{
  setProgress(4);

  reportData.comment = E("comment").value.substr(0, 1000);

  document.documentElement.canRewind = false;
  document.documentElement.getButton("finish").disabled = true;

  let guid = Cc["@mozilla.org/uuid-generator;1"].getService(Ci.nsIUUIDGenerator).generateUUID().toString().replace(/[\{\}]/g, "");
  let url = Prefs.report_submiturl.replace(/%GUID%/g, guid).replace(/%LANG%/g, Utils.appLocale);
  let request = new XMLHttpRequest();
  request.open("POST", url);
  request.setRequestHeader("Content-Type", "text/xml");
  request.setRequestHeader("X-Adblock-Plus", "1");
  request.onload = reportSent;
  request.onerror = reportSent;
  request.send(reportData.toXMLString());
}

function reportSent(event)
{
  let request = event.target;
  let success = false;
  let errorMessage = Utils.getString("synchronize_connection_error");
  try
  {
    success = (request.status == 200);
    errorMessage = request.status + " " + request.statusText;
  } catch (e) {}

  let result = "";
  try
  {
    result = request.responseText;
  } catch (e) {}

  if (!success)
  {
    errorMessage = errorMessage.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    errorMessage = "<h1 style=\"color: red;\">" + errorMessage + "</h1>";

    let regexp = /<body\b[^<>]*>/;
    if (regexp.test(result))
      result = result.replace(regexp, "$0" + errorMessage);
    else
      result = errorMessage + result;
  }

  E("sendReportProgress").hidden = true;

  let frame = E("result");
  frame.docShell.allowAuth = false;
  frame.docShell.allowJavascript = false;
  frame.docShell.allowMetaRedirects = false;
  frame.docShell.allowPlugins = false;
  frame.docShell.allowSubframes = false;

  E("result").setAttribute("src", "data:text/html," + encodeURIComponent(result));
  E("result").hidden = false;

  if (success)
  {
    try
    {
      let link = request.responseXML.getElementById("link").getAttribute("href");
      let button = E("copyLink");
      button.setAttribute("url", link);
      button.removeAttribute("disabled");
    } catch (e) {}
    E("copyLinkBox").hidden = false;

    document.documentElement.getButton("finish").disabled = false;
    document.documentElement.getButton("cancel").disabled = true;
    setProgress(5);
  }
}

function processLinkClick(event)
{
  event.preventDefault();

  let link = event.target;
  while (link && !(link instanceof HTMLAnchorElement))
    link = link.parentNode;

  if (link && (link.protocol == "http:" || link.protocol == "https:"))
    Utils.loadInBrowser(link.href);
}

function copyLink(url)
{
  let clipboardHelper = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);
  clipboardHelper.copyString(url);
}

function censorURL(url)
{
  return url.replace(/([?;&\/#][^?;&\/#]+?=)[^?;&\/#]+/g, "$1*");
}
