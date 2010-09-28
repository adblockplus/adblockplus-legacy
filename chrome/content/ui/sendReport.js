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

const imageOffset = 10;

let contentWindow = window.arguments[0];

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

let imageCanvas = null;
let imageContext = null;
let imageSelectionType = "mark";
let imageCurrentData = null;
let imageUndoQueue = [];

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

  let requests = reportData.requests;
  let filters = reportData.filters;
  let subscriptions = reportData.subscriptions;
  let requestNotifier = new RequestNotifier(contentWindow, function(frame, node, entry, scanComplete)
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

      requests.appendChild(requestXML);
    }

    if (scanComplete)
    {
      requestNotifier.shutdown();

      let wndStats = RequestNotifier.getWindowStatistics(contentWindow);
      if (wndStats)
      {
        for (let f in wndStats.filters)
        {
          let filter = Filter.fromText(f)
          let hitCount = wndStats.filters[f];
          filters.appendChild(<filter text={filter.text} subscriptions={filter.subscriptions.map(function(s) s.url).join(" ")} hitCount={hitCount}/>);
        }
      }

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

      initCanvas();
    }
  });
}

function initCanvas()
{
  imageCanvas = E("screenshotCanvas");
  imageCanvas.width = imageCanvas.offsetWidth;
  imageContext = imageCanvas.getContext("2d");
  let wndWidth = contentWindow.document.documentElement.scrollWidth;
  let wndHeight = contentWindow.document.documentElement.scrollHeight;

  // Copy scaled screenshot of the webpage. We scale the webpage by width
  // but leave 10px on each side for easier selecting.

  // Gecko doesn't like sizes more than 64k, restrict to 30k to be on the safe side.
  // Also, make sure height is at most five times the width to keep image size down.
  let copyWidth = Math.min(wndWidth, 30000);
  let copyHeight = Math.min(wndHeight, 30000, copyWidth * 5);
  let copyX = Math.max(Math.min(contentWindow.scrollX - copyWidth / 2, wndWidth - copyWidth), 0);
  let copyY = Math.max(Math.min(contentWindow.scrollY - copyHeight / 2, wndHeight - copyHeight), 0);

  let scalingFactor = (imageCanvas.width - imageOffset * 2) / copyWidth;
  imageCanvas.height = copyHeight * scalingFactor + imageOffset * 2;

  imageContext.save();
  imageContext.translate(imageOffset, imageOffset);
  imageContext.scale(scalingFactor, scalingFactor);
  imageContext.drawWindow(contentWindow, copyX, copyY, copyWidth, copyHeight, "rgb(255,255,255)");
  imageContext.restore();

  // Init canvas settings
  imageContext.fillStyle = "rgb(0, 0, 0)";
  imageContext.strokeStyle = "rgba(255, 0, 0, 0.7)";
  imageContext.lineWidth = 3;
  imageContext.lineJoin = "round";

  // Reduce colors asynchronously
  let mapping = [0x00,  0x55,  0xAA,  0xFF];
  let currentThread = Utils.threadManager.currentThread;
  let imageData = imageContext.getImageData(imageOffset, imageOffset, imageCanvas.width - imageOffset * 2, imageCanvas.height - imageOffset * 2);
  let bytes = imageData.width * imageData.height * 4;
  let i = 0;
  let runnable =
  {
    run: function()
    {
      // Process only 5000 bytes at a time to prevent browser hangs
      let endIndex = Math.min(i + 5000, bytes);
      for (; i < endIndex; i++)
        imageData.data[i] = mapping[imageData.data[i] >> 6];

      if (i >= bytes)
      {
        // Color changes done, now save data back and finish initialization
        imageContext.putImageData(imageData, imageOffset, imageOffset);
        finishInitialization();
      }
      else
        currentThread.dispatch(this, Ci.nsIEventTarget.DISPATCH_NORMAL);
    }
  };
  currentThread.dispatch(runnable, Ci.nsIEventTarget.DISPATCH_NORMAL);
}

function finishInitialization()
{
  // Collect frame data
  reportData.window.@url = censorURL(contentWindow.location.href);
  scanFrames(contentWindow, reportData.window);

  // Collect error messages
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

  // All done, go to next page
  document.documentElement.canAdvance = true;
  document.documentElement.advance();
}

function scanFrames(wnd, xmlList)
{
  try
  {
    for (let i = 0; i < wnd.frames.length; i++)
    {
      let frame = wnd.frames[i];
      let frameXML = <frame url={censorURL(frame.location.href)}/>;
      scanFrames(frame, frameXML);
      xmlList.appendChild(frameXML);
    }
  }
  catch (e)
  {
    // Don't break if something goes wrong
    Cu.reportError(e);
  }
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

function enableCanvas(enable)
{
  imageCanvas.style.opacity = enable ? "" : "0.3";

  E("screenshotMarkButton").disabled = !enable;
  E("screenshotRemoveButton").disabled = !enable;
  E("screenshotUndoButton").disabled = !enable || !imageUndoQueue.length;
}

function setImageSelectionType(type)
{
  if (imageSelectionType == type)
    return;

  // Abort selection already in progress
  abortSelection();

  imageSelectionType = type;
}

function abortSelection()
{
  if (imageCurrentData && imageCurrentData.data)
  {
    imageContext.putImageData(imageCurrentData.data,
      Math.min(imageCurrentData.anchorX, imageCurrentData.currentX),
      Math.min(imageCurrentData.anchorY, imageCurrentData.currentY));
  }
  document.removeEventListener("keypress", imageHandleKeyPress, true);
  imageCurrentData = null;
}

function imageHandleKeyPress(event)
{
  if (event.keyCode == Ci.nsIDOMKeyEvent.DOM_VK_ESCAPE)
  {
    event.stopPropagation();
    event.preventDefault();
    abortSelection();
  }
}

function imageStartSelection(event)
{
  if (event.button == 2)
    abortSelection();   // Right mouse button aborts selection

  if (event.button != 0 || !E("screenshotCheckbox").checked)
    return;

  // Abort selection already in progress
  abortSelection();

  imageCurrentData = {
    data: null,
    anchorX: event.layerX,
    anchorY: event.layerY,
    currentX: -1,
    currentY: -1
  };
  imageUpdateSelection(event);

  document.addEventListener("keypress", imageHandleKeyPress, true);
}

function imageUpdateSelection(event)
{
  if (event.button != 0 || !imageCurrentData)
    return;

  if (imageCurrentData.currentX == event.layerX && imageCurrentData.currentY == event.layerY)
    return;

  if (imageCurrentData.data)
  {
    imageContext.putImageData(imageCurrentData.data,
      Math.min(imageCurrentData.anchorX, imageCurrentData.currentX),
      Math.min(imageCurrentData.anchorY, imageCurrentData.currentY));
  }

  imageCurrentData.currentX = event.layerX;
  imageCurrentData.currentY = event.layerY;

  let left = Math.min(imageCurrentData.anchorX, imageCurrentData.currentX);
  let right = Math.max(imageCurrentData.anchorX, imageCurrentData.currentX);
  let top = Math.min(imageCurrentData.anchorY, imageCurrentData.currentY);
  let bottom = Math.max(imageCurrentData.anchorY, imageCurrentData.currentY);

  let minDiff = (imageSelectionType == "mark" ? 3 : 1);
  if (right - left >= minDiff && bottom - top >= minDiff)
    imageCurrentData.data = imageContext.getImageData(left, top, right - left, bottom - top);
  else
    imageCurrentData.data = null;

  if (imageSelectionType == "mark")
  {
    // all coordinates need to be moved 1.5px inwards to get the desired result
    left += 1.5;
    right -= 1.5;
    top += 1.5;
    bottom -= 1.5;
    if (left < right && top < bottom)
      imageContext.strokeRect(left, top, right - left, bottom - top);
  }
  else if (imageSelectionType == "remove")
    imageContext.fillRect(left, top, right - left, bottom - top);
}

function imageStopSelection(event)
{
 if (event.button != 0 || !imageCurrentData)
  return;

  if (imageCurrentData.data)
  {
    imageUndoQueue.push(imageCurrentData);
    E("screenshotUndoButton").disabled = false;
  }

  imageCurrentData = null;
  document.removeEventListener("keypress", imageHandleKeyPress, true);
}

function undoImageOperation()
{
  let op = imageUndoQueue.pop();
  if (!op)
    return;

  imageContext.putImageData(op.data,
    Math.min(op.anchorX, op.currentX),
    Math.min(op.anchorY, op.currentY));

  if (!imageUndoQueue.length)
    E("screenshotUndoButton").disabled = true;
}

function initCommentPage()
{
  setProgress(3);

  if (E("screenshotCheckbox").checked)
    reportData.screenshot = imageCanvas.toDataURL();
  else
    delete reportData.screenshot;

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
