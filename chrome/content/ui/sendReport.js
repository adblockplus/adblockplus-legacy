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

//
// Report data template, more data will be added during data collection
//

let {Services} = Cu.import("resource://gre/modules/Services.jsm", {});
let {FileUtils} = Cu.import("resource://gre/modules/FileUtils.jsm", {});

const MILLISECONDS_IN_SECOND = 1000;
const SECONDS_IN_MINUTE = 60;
const SECONDS_IN_HOUR = 60 * SECONDS_IN_MINUTE;
const SECONDS_IN_DAY = 24 * SECONDS_IN_HOUR;

let outerWindowID = window.arguments[0];
let windowURI = window.arguments[1];
if (typeof windowURI == "string")
  windowURI = Services.newURI(windowURI, null, null);
let browser = window.arguments[2];
let isPrivate = false;

let reportData = new DOMParser().parseFromString("<report></report>", "text/xml");

// Some helper functions to work with the report data
function reportElement(tag)
{
  for (let child = reportData.documentElement.firstChild; child; child = child.nextSibling)
    if (child.nodeType == Node.ELEMENT_NODE && child.tagName == tag)
      return child;
  let element = reportData.createElement(tag);
  reportData.documentElement.appendChild(element);
  return element;
}
function removeReportElement(tag)
{
  for (let child = reportData.documentElement.firstChild; child; child = child.nextSibling)
    if (child.nodeType == Node.ELEMENT_NODE && child.tagName == tag)
      child.parentNode.removeChild(child);
}
function appendElement(parent, tag, attributes, body)
{
  let element = parent.ownerDocument.createElement(tag);
  if (typeof attributes == "object" && attributes !== null)
    for (let attribute in attributes)
      if (attributes.hasOwnProperty(attribute))
        element.setAttribute(attribute, attributes[attribute]);
  if (typeof body != "undefined" && body !== null)
    element.textContent = body;
  parent.appendChild(element);
  return element;
}
function serializeReportData()
{
  let result = new XMLSerializer().serializeToString(reportData);

  // Insert line breaks before each new tag
  result = result.replace(/(<[^\/]([^"<>]*|"[^"]*")*>)/g, "\n$1");
  result = result.replace(/^\n+/, "");
  return result;
}

{
  let element = reportElement("adblock-plus");
  let {addonVersion} = require("info");
  element.setAttribute("version", addonVersion);
  element.setAttribute("locale", Utils.appLocale);
}
{
  let element = reportElement("application");
  element.setAttribute("name", Services.appinfo.name);
  element.setAttribute("vendor", Services.appinfo.vendor);
  element.setAttribute("version", Services.appinfo.version);
  element.setAttribute("userAgent", window.navigator.userAgent);
}
{
  let element = reportElement("platform");
  element.setAttribute("name", "Gecko");
  element.setAttribute("version", Services.appinfo.platformVersion);
  element.setAttribute("build", Services.appinfo.platformBuildID);
};
{
  let element = reportElement("options");
  appendElement(element, "option", {id: "enabled"}, Prefs.enabled);
  appendElement(element, "option", {id: "objecttabs"}, Prefs.frameobjects);
  appendElement(element, "option", {id: "collapse"}, !Prefs.fastcollapse);
  appendElement(element, "option", {id: "subscriptionsAutoUpdate"}, Prefs.subscriptions_autoupdate);
  appendElement(element, "option", {id: "javascript"}, Services.prefs.getBoolPref("javascript.enabled"));
  appendElement(element, "option", {id: "cookieBehavior"}, Services.prefs.getIntPref("network.cookie.cookieBehavior"));
};

//
// Data collectors
//

var reportsListDataSource =
{
  list: [],

  collectData: function(outerWindowID, windowURI, browser, callback)
  {
    let data = Prefs.recentReports;
    if (data && "length" in data)
    {
      for (let i = 0; i < data.length; i++)
      {
        let entry = data[i];
        if (typeof entry.reportURL == "string" && entry.reportURL &&
            typeof entry.time == "number" && Date.now() - entry.time < 30*24*60*60*1000)
        {
          let newEntry = {site: null, reportURL: entry.reportURL, time: entry.time};
          if (typeof entry.site == "string" && entry.site)
            newEntry.site = entry.site;
          this.list.push(newEntry);
        }
      }
    }

    if (this.list.length > 10)
      this.list.splice(10);

    E("recentReports").hidden = !this.list.length;
    if (this.list.length)
    {
      let rows = E("recentReportsRows")
      for (let i = 0; i < this.list.length; i++)
      {
        let entry = this.list[i];
        let row = document.createElement("row");

        let link = document.createElement("description");
        link.setAttribute("class", "text-link");
        link.setAttribute("url", entry.reportURL);
        link.textContent = entry.reportURL.replace(/^.*\/(?=[^\/])/, "");
        row.appendChild(link);

        let site = document.createElement("description");
        if (entry.site)
          site.textContent = entry.site;
        row.appendChild(site);

        let time = document.createElement("description");
        time.textContent = Utils.formatTime(entry.time);
        row.appendChild(time);

        rows.appendChild(row);
      }
    }

    callback();
  },

  addReport: function(site, reportURL)
  {
    this.list.unshift({site: site, reportURL: reportURL, time: Date.now()});
    Prefs.recentReports = this.list;
  },

  clear: function()
  {
    this.list = [];
    Prefs.recentReports = this.list;
    E("recentReports").hidden = true;
  },

  handleClick: function(event)
  {
    if (event.button != 0 || !event.target || !event.target.hasAttribute("url"))
      return;

    UI.loadInBrowser(event.target.getAttribute("url"));
  }
};

var requestsDataSource =
{
  requests: reportElement("requests"),
  origRequests: [],
  requestNotifier: null,
  callback: null,
  nodeByKey: Object.create(null),

  collectData: function(outerWindowID, windowURI, browser, callback)
  {
    this.callback = callback;
    this.requestNotifier = new RequestNotifier(outerWindowID, this.onRequestFound, this);
  },

  onRequestFound: function(entry, scanComplete)
  {
    if (entry)
    {
      let key = entry.location + " " + entry.type + " " + entry.docDomain;
      let requestXML;
      if (key in this.nodeByKey)
      {
        requestXML = this.nodeByKey[key];
        requestXML.setAttribute("count", parseInt(requestXML.getAttribute("count"), 10) + 1);
      }
      else
      {
        requestXML = this.nodeByKey[key] = appendElement(this.requests, "request", {
          location: censorURL(entry.location),
          type: entry.type,
          docDomain: entry.docDomain,
          thirdParty: entry.thirdParty,
          count: 1
        });

        // Location is meaningless for element hiding hits
        if (requestXML.getAttribute("location")[0] == "#")
          requestXML.removeAttribute("location");
      }

      if (entry.filter)
        requestXML.setAttribute("filter", entry.filter);

      this.origRequests.push(entry);
    }

    if (scanComplete)
    {
      this.requestNotifier.shutdown();
      this.requestNotifier = null;
      this.callback();
    }
  }
};

var filtersDataSource =
{
  origFilters: [],

  collectData: function(outerWindowID, windowURI, browser, callback)
  {
    RequestNotifier.getWindowStatistics(outerWindowID, (wndStats) =>
    {
      if (wndStats)
      {
        let filters = reportElement("filters");
        for (let f in wndStats.filters)
        {
          let filter = Filter.fromText(f)
          let hitCount = wndStats.filters[f];
          appendElement(filters, "filter", {
            text: filter.text,
            subscriptions: filter.subscriptions.filter(subscriptionsDataSource.subscriptionFilter).map(s => s.url).join(" "),
            hitCount: hitCount
          });
          this.origFilters.push(filter);
        }
      }
      callback();
    });
  }
};

var subscriptionsDataSource =
{
  subscriptionFilter: function(s)
  {
    if (s.disabled || !(s instanceof RegularSubscription))
      return false;
    if (s instanceof DownloadableSubscription && !/^(http|https|ftp):/i.test(s.url))
      return false;
    return true;
  },

  collectData: function(outerWindowID, windowURI, browser, callback)
  {
    let subscriptions = reportElement("subscriptions");
    let now = Math.round(Date.now() / 1000);
    for (let i = 0; i < FilterStorage.subscriptions.length; i++)
    {
      let subscription = FilterStorage.subscriptions[i];
      if (!this.subscriptionFilter(subscription))
        continue;

      let subscriptionXML = appendElement(subscriptions, "subscription", {
        id: subscription.url,
        disabledFilters: subscription.filters.filter(filter => filter instanceof ActiveFilter && filter.disabled).length
      });
      if (subscription.version)
        subscriptionXML.setAttribute("version", subscription.version);
      if (subscription.lastDownload)
        subscriptionXML.setAttribute("lastDownloadAttempt", subscription.lastDownload - now);
      if (subscription instanceof DownloadableSubscription)
      {
        if (subscription.lastSuccess)
          subscriptionXML.setAttribute("lastDownloadSuccess", subscription.lastSuccess - now);
        if (subscription.softExpiration)
          subscriptionXML.setAttribute("softExpiration", subscription.softExpiration - now);
        if (subscription.expires)
          subscriptionXML.setAttribute("hardExpiration", subscription.expires - now);
        subscriptionXML.setAttribute("downloadStatus", subscription.downloadStatus);
      }
    }
    callback();
  }
};

var remoteDataSource =
{
  collectData: function(outerWindowID, windowURI, browser, callback)
  {
    let {port} = require("messaging");
    let screenshotWidth = screenshotDataSource.getWidth();
    port.emitWithResponse("collectData", {outerWindowID, screenshotWidth})
        .then(data =>
    {
      screenshotDataSource.setData(data && data.screenshot);
      framesDataSource.setData(windowURI, data && data.opener, data && data.referrer, data && data.frames);

      if (data && data.isPrivate)
        isPrivate = true;
      let element = reportElement("options");
      appendElement(element, "option", {id: "privateBrowsing"}, isPrivate);

      callback();
    });
  }
}

var screenshotDataSource =
{
  imageOffset: 10,

  // Fields used for user interaction
  _enabled: true,
  _canvas: null,
  _context: null,
  _selectionType: "mark",
  _currentData: null,
  _undoQueue: [],

  getWidth: function()
  {
    let canvas = E("screenshotCanvas");
    return canvas.offsetWidth - this.imageOffset * 2;
  },

  setData: function(screenshot)
  {
    let canvas = E("screenshotCanvas");

    // Do not resize canvas any more (no idea why Gecko requires both to be set)
    canvas.parentNode.style.MozBoxAlign = "center";
    canvas.parentNode.align = "center";

    let context = canvas.getContext("2d");
    this._canvas = canvas;
    this._context = context;

    if (screenshot)
    {
      canvas.width = screenshot.width + this.imageOffset * 2;
      canvas.height = screenshot.height + this.imageOffset * 2;
      context.putImageData(screenshot, this.imageOffset, this.imageOffset);
    }

    // Init canvas settings
    context.fillStyle = "rgb(0, 0, 0)";
    context.strokeStyle = "rgba(255, 0, 0, 0.7)";
    context.lineWidth = 3;
    context.lineJoin = "round";
  },

  get enabled()
  {
    return this._enabled;
  },
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

  get selectionType()
  {
    return this._selectionType;
  },
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
    removeReportElement("screenshot");
    if (this.enabled)
    {
      appendElement(reportData.documentElement, "screenshot", {
        edited: (this._undoQueue.length ? 'true' : 'false')
      }, this._canvas.toDataURL());
    }
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

    let boxObject = document.getBoxObjectFor(this._canvas);
    let [x, y] = [event.screenX - boxObject.screenX, event.screenY - boxObject.screenY];
    this._currentData = {
      data: null,
      anchorX: x,
      anchorY: y,
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

    let boxObject = document.getBoxObjectFor(this._canvas);
    let [x, y] = [event.screenX - boxObject.screenX, event.screenY - boxObject.screenY];
    if (this._currentData.currentX == x && this._currentData.currentY == y)
      return;

    if (this._currentData.data)
    {
      this._context.putImageData(this._currentData.data,
        Math.min(this._currentData.anchorX, this._currentData.currentX),
        Math.min(this._currentData.anchorY, this._currentData.currentY));
    }

    this._currentData.currentX = x;
    this._currentData.currentY = y;

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

var framesDataSource =
{
  site: null,

  setData: function(windowURI, opener, referrer, frames)
  {
    try
    {
      this.site = windowURI.host;
      if (this.site)
        document.title += " (" + this.site + ")";
    }
    catch (e)
    {
      // Expected exception - not all URL schemes have a host name
    }

    let window = reportElement("window");
    window.setAttribute("url", censorURL(windowURI.spec));
    if (opener)
      window.setAttribute("opener", censorURL(opener));
    if (referrer)
      window.setAttribute("referrer", censorURL(referrer));
    this.addFrames(frames || [], window);
  },

  addFrames: function(frames, xmlList)
  {
    for (let frame of frames)
    {
      let frameXML = appendElement(xmlList, "frame", {
        url: censorURL(frame.url)
      });
      this.addFrames(frame.frames, frameXML);
    }
  }
};

var errorsDataSource =
{
  collectData: function(outerWindowID, windowURI, browser, callback)
  {
    let {addonID} = require("info");
    addonID = addonID.replace(/[\{\}]/g, "");

    // See https://bugzilla.mozilla.org/show_bug.cgi?id=664695 - starting with
    // Gecko 19 this function returns the result, before that it wrote to a
    // parameter.
    let outparam = {};
    let messages = Cc["@mozilla.org/consoleservice;1"].getService(Ci.nsIConsoleService).getMessageArray(outparam, {});
    messages = messages || outparam.value || [];
    messages = messages.filter(function(message)
    {
      return (message instanceof Ci.nsIScriptError &&
          !/^https?:/i.test(message.sourceName) &&
          (/adblock/i.test(message.errorMessage) || /adblock/i.test(message.sourceName) ||
           message.errorMessage.indexOf(addonID) >= 0 || message.sourceName && message.sourceName.indexOf(addonID) >= 0));
    });
    if (messages.length > 10)   // Only the last 10 messages
      messages = messages.slice(messages.length - 10, messages.length);

    // Censor app and profile paths in error messages
    let censored = Object.create(null);
    let pathList = [["ProfD", "%PROFILE%"], ["GreD", "%GRE%"], ["CurProcD", "%APP%"]];
    for (let i = 0; i < pathList.length; i++)
    {
      let [pathID, placeholder] = pathList[i];
      try
      {
        let file = FileUtils.getDir(pathID, [], false);
        censored[file.path.replace(/[\\\/]+$/, '')] = placeholder;
        let uri = Utils.ioService.newFileURI(file);
        censored[uri.spec.replace(/[\\\/]+$/, '')] = placeholder;
      } catch(e) {}
    }

    function str2regexp(str, flags)
    {
      return new RegExp(str.replace(/\W/g, "\\$&"), flags);
    }

    let errors = reportElement("errors");
    for (let i = 0; i < messages.length; i++)
    {
      let message = messages[i];

      let text = message.errorMessage;
      for (let path in censored)
        text = text.replace(str2regexp(path, "gi"), censored[path]);
      if (text.length > 256)
        text = text.substr(0, 256) + "...";

      let file = message.sourceName;
      for (let path in censored)
        file = file.replace(str2regexp(path, "gi"), censored[path]);
      if (file.length > 256)
        file = file.substr(0, 256) + "...";

      let sourceLine = message.sourceLine;
      if (sourceLine.length > 256)
        sourceLine = sourceLine.substr(0, 256) + "...";

      appendElement(errors, "error", {
        type: message.flags & Ci.nsIScriptError.warningFlag ? "warning" : "error",
        text: text,
        file: file,
        line: message.lineNumber,
        column: message.columnNumber,
        sourceLine: sourceLine
      });
    }

    callback();
  }
};

var extensionsDataSource =
{
  data: reportData.createElement("extensions"),

  collectData: function(outerWindowID, windowURI, browser, callback)
  {
    try
    {
      let AddonManager = Cu.import("resource://gre/modules/AddonManager.jsm", null).AddonManager;
      AddonManager.getAddonsByTypes(["extension", "plugin"], function(items)
      {
        for (let i = 0; i < items.length; i++)
        {
          let item = items[i];
          if (!item.isActive)
            continue;
          appendElement(this.data, "extension", {
            id: item.id,
            name: item.name,
            type: item.type,
            version: item.version
          });
        }
        callback();
      }.bind(this));
    }
    catch (e)
    {
      // No add-on manager, what's going on? Skip this step.
      callback();
    }
  },

  exportData: function(doExport)
  {
    if (doExport)
      reportData.documentElement.appendChild(this.data);
    else if (this.data.parentNode)
      this.data.parentNode.removeChild(this.data);
  }
};

var subscriptionUpdateDataSource =
{
  browser: null,
  type: null,
  outdated: null,
  needUpdate: null,

  subscriptionFilter: function(s)
  {
    if (s instanceof DownloadableSubscription)
      return subscriptionsDataSource.subscriptionFilter(s);
    else
      return false;
  },

  collectData: function(outerWindowID, windowURI, browser, callback)
  {
    this.browser = browser;
    let now = Date.now() / MILLISECONDS_IN_SECOND;
    let outdatedThreshold = now - 14 * SECONDS_IN_DAY;
    let needUpdateThreshold = now - 1 * SECONDS_IN_HOUR;

    this.outdated = [];
    this.needUpdate = [];

    let subscriptions = FilterStorage.subscriptions.filter(this.subscriptionFilter);
    for (let i = 0; i < subscriptions.length; i++)
    {
      let lastSuccess = subscriptions[i].lastSuccess;
      if (lastSuccess < outdatedThreshold)
        this.outdated.push(subscriptions[i]);
      if (lastSuccess < needUpdateThreshold)
        this.needUpdate.push(subscriptions[i]);
    }

    callback();
  },

  updatePage: function(type)
  {
    this.type = type;
    E("updateInProgress").hidden = (type != "false positive" || this.needUpdate.length == 0);
    E("outdatedSubscriptions").hidden = !E("updateInProgress").hidden || this.outdated.length == 0;
    if (!E("outdatedSubscriptions").hidden)
    {
      let template = E("outdatedSubscriptionTemplate");
      let list = E("outdatedSubscriptionsList");
      while (list.lastChild)
        list.removeChild(list.lastChild);

      for (let i = 0; i < this.outdated.length; i++)
      {
        let subscription = this.outdated[i];
        let entry = template.cloneNode(true);
        entry.removeAttribute("id");
        entry.removeAttribute("hidden");
        entry.setAttribute("_url", subscription.url);
        entry.setAttribute("tooltiptext", subscription.url);
        entry.textContent = getSubscriptionTitle(subscription);
        list.appendChild(entry);
      }
    }
    return !E("updateInProgress").hidden || !E("outdatedSubscriptions").hidden;
  },

  showPage: function()
  {
    document.documentElement.canAdvance = false;

    if (!E("updateInProgress").hidden)
    {
      document.documentElement.canRewind = false;

      for (let i = 0; i < this.needUpdate.length; i++)
        Synchronizer.execute(this.needUpdate[i], true);

      let listener = function(action)
      {
        if (!/^subscription\./.test(action))
          return;

        for (let i = 0; i < this.needUpdate.length; i++)
          if (Synchronizer.isExecuting(this.needUpdate[i].url))
            return;

        FilterNotifier.removeListener(listener);
        E("updateInProgress").hidden = "true";

        let filtersRemoved = false;
        let requests = requestsDataSource.origRequests;
        for (let i = 0; i < requests.length; i++)
        {
          if (!requests[i].filter)
            continue;

          let filter = Filter.fromText(requests[i].filter);
          if (!filter.subscriptions.some(s => !s.disabled))
            filtersRemoved = true;
        }

        if (filtersRemoved)
        {
          // Force the user to reload the page
          E("updateFixedIssue").hidden = false;
          document.documentElement.canAdvance = true;

          let nextButton = document.documentElement.getButton("next");
          [nextButton.label, nextButton.accessKey] = Utils.splitLabel(E("updatePage").getAttribute("reloadButtonLabel"));
          document.documentElement.addEventListener("wizardnext", event =>
          {
            event.preventDefault();
            event.stopPropagation();
            window.close();
            this.browser.reload();
          }, true);
        }
        else
        {
          this.collectData(null, null, null, function() {});
          this.needUpdate = [];
          if (this.outdated.length)
          {
            document.documentElement.canRewind = true;

            this.updatePage(this.type);
            this.showPage();
          }
          else
          {
            // No more issues, make sure to remove this page from history and
            // advance to the next page.
            document.documentElement.canRewind = true;
            document.documentElement.canAdvance = true;

            let next = document.documentElement.currentPage.next;
            document.documentElement.rewind();
            document.documentElement.currentPage.next = next;

            document.documentElement.advance();
          }
        }
      }.bind(this);

      FilterNotifier.addListener(listener);
      window.addEventListener("unload", function()
      {
        FilterNotifier.removeListener(listener);
      });
    }
  },

  updateOutdated: function()
  {
    for (let i = 0; i < this.outdated.length; i++)
      Synchronizer.execute(this.outdated[i], true);
  }
}

var issuesDataSource =
{
  browser: null,
  isEnabled: Prefs.enabled,
  whitelistFilter: null,
  disabledFilters: [],
  disabledSubscriptions: [],
  ownFilters: [],
  numSubscriptions: 0,
  numAppliedFilters: Infinity,

  subscriptionFilter: function(s)
  {
    if (s instanceof DownloadableSubscription &&
        s.url != Prefs.subscriptions_exceptionsurl &&
        s.url != Prefs.subscriptions_antiadblockurl)
    {
      return subscriptionsDataSource.subscriptionFilter(s);
    }
    else
      return false;
  },

  collectData: function(outerWindowID, windowURI, browser, callback)
  {
    this.browser = browser;
    this.whitelistFilter = Policy.isWhitelisted(windowURI.spec);

    if (!this.whitelistFilter && this.isEnabled)
    {
      // Find disabled filters in active subscriptions matching any of the requests
      let disabledMatcher = new CombinedMatcher();
      for (let subscription of FilterStorage.subscriptions)
      {
        if (subscription.disabled)
          continue;

        for (let filter of subscription.filters)
          if (filter instanceof BlockingFilter && filter.disabled)
            disabledMatcher.add(filter);
      }

      let seenFilters = Object.create(null);
      for (let request of requestsDataSource.origRequests)
      {
        if (request.filter)
          continue;

        let filter = disabledMatcher.matchesAny(request.location, RegExpFilter.typeMap[request.type], request.docDomain, request.thirdParty);
        if (filter && !(filter.text in seenFilters))
        {
          this.disabledFilters.push(filter);
          seenFilters[filter.text] = true;
        }
      }

      // Find disabled subscriptions with filters matching any of the requests
      let seenSubscriptions = Object.create(null);
      for (let subscription of FilterStorage.subscriptions)
      {
        if (!subscription.disabled)
          continue;

        disabledMatcher.clear();
        for (let filter of subscription.filters)
          if (filter instanceof BlockingFilter)
            disabledMatcher.add(filter);

        for (let request of requestsDataSource.origRequests)
        {
          if (request.filter)
            continue;

          let filter = disabledMatcher.matchesAny(request.location, RegExpFilter.typeMap[request.type], request.docDomain, request.thirdParty);
          if (filter && !(subscription.url in seenSubscriptions))
          {
            this.disabledSubscriptions.push(subscription);
            seenSubscriptions[subscription.text] = true;
            break;
          }
        }
      }

      this.numSubscriptions = FilterStorage.subscriptions.filter(this.subscriptionFilter).length;
      this.numAppliedFilters = 0;
      for (let filter of filtersDataSource.origFilters)
      {
        if (filter instanceof WhitelistFilter)
          continue;

        this.numAppliedFilters++;
        if (filter.subscriptions.some(subscription => subscription instanceof SpecialSubscription))
          this.ownFilters.push(filter);
      }
    }

    callback();
  },

  updateIssues: function(type)
  {
    if (type == "other")
    {
      E("typeSelectorPage").next = "typeWarning";
      return;
    }

    E("issuesWhitelistBox").hidden = !this.whitelistFilter;
    E("issuesDisabledBox").hidden = this.isEnabled;
    E("issuesNoFiltersBox").hidden = (type != "false positive" || this.numAppliedFilters > 0);
    E("issuesNoSubscriptionsBox").hidden = (type != "false negative" || this.numAppliedFilters > 0 || this.numSubscriptions > 0);
    E("issuesSubscriptionCountBox").hidden = (this.numSubscriptions < 5);

    let ownFiltersBox = E("issuesOwnFilters");
    if (this.ownFilters.length && !ownFiltersBox.firstChild)
    {
      let template = E("issuesOwnFiltersTemplate");
      for (let filter of this.ownFilters)
      {
        let element = template.cloneNode(true);
        element.removeAttribute("id");
        element.removeAttribute("hidden");
        element.firstChild.setAttribute("value", filter.text);
        element.firstChild.setAttribute("tooltiptext", filter.text);
        element.abpFilter = filter;
        ownFiltersBox.appendChild(element);
      }
    }
    E("issuesOwnFiltersBox").hidden = (type != "false positive" || this.ownFilters.length == 0);

    let disabledSubscriptionsBox = E("issuesDisabledSubscriptions");
    if (this.disabledSubscriptions.length && !disabledSubscriptionsBox.firstChild)
    {
      let template = E("issuesDisabledSubscriptionsTemplate");
      for (let subscription of this.disabledSubscriptions)
      {
        let element = template.cloneNode(true);
        element.removeAttribute("id");
        element.removeAttribute("hidden");
        element.firstChild.setAttribute("value", getSubscriptionTitle(subscription));
        element.setAttribute("tooltiptext", subscription instanceof DownloadableSubscription ? subscription.url : getSubscriptionTitle(subscription));
        element.abpSubscription = subscription;
        disabledSubscriptionsBox.appendChild(element);
      }
    }
    E("issuesDisabledSubscriptionsBox").hidden = (type != "false negative" || this.disabledSubscriptions.length == 0);

    let disabledFiltersBox = E("issuesDisabledFilters");
    if (this.disabledFilters.length && !disabledFiltersBox.firstChild)
    {
      let template = E("issuesDisabledFiltersTemplate");
      for (let filter of this.disabledFilters)
      {
        let element = template.cloneNode(true);
        element.removeAttribute("id");
        element.removeAttribute("hidden");
        element.firstChild.setAttribute("value", filter.text);
        element.setAttribute("tooltiptext", filter.text);
        element.abpFilter = filter;
        disabledFiltersBox.appendChild(element);
      }
    }
    E("issuesDisabledFiltersBox").hidden = (type != "false negative" || this.disabledFilters.length == 0);

    // Don't allow sending report if the page is whitelisted - we need the data.
    // Also disallow reports without matching filters or without subscriptions,
    // subscription authors cannot do anything about those.
    E("issuesOverride").hidden = !E("issuesWhitelistBox").hidden ||
                                 !E("issuesDisabledBox").hidden ||
                                 !E("issuesNoFiltersBox").hidden ||
                                 !E("issuesNoSubscriptionsBox").hidden ||
                                 !E("issuesSubscriptionCountBox").hidden;

    let page = E("typeSelectorPage");
    if (subscriptionUpdateDataSource.updatePage(type))
    {
      page.next = "update";
      page = E("updatePage");
    }

    if (E("issuesWhitelistBox").hidden && E("issuesDisabledBox").hidden &&
        E("issuesNoFiltersBox").hidden && E("issuesNoSubscriptionsBox").hidden &&
        E("issuesOwnFiltersBox").hidden && E("issuesDisabledFiltersBox").hidden &&
        E("issuesDisabledSubscriptionsBox").hidden && E("issuesSubscriptionCountBox").hidden)
    {
      page.next = "screenshot";
    }
    else
    {
      page.next = "issues";
    }
  },

  forceReload: function()
  {
    // User changed configuration, don't allow sending report now - page needs
    // to be reloaded
    E("issuesOverride").hidden = true;
    E("issuesChangeMessage").hidden = false;
    document.documentElement.canRewind = false;
    document.documentElement.canAdvance = true;

    let nextButton = document.documentElement.getButton("next");
    [nextButton.label, nextButton.accessKey] = Utils.splitLabel(E("updatePage").getAttribute("reloadButtonLabel"));
    document.documentElement.addEventListener("wizardnext", event =>
    {
      event.preventDefault();
      event.stopPropagation();
      window.close();
      this.browser.reload();
    }, true);
  },

  removeWhitelist: function()
  {
    if (this.whitelistFilter && this.whitelistFilter.subscriptions.length)
      this.whitelistFilter.disabled = true;
    E("issuesWhitelistBox").hidden = true;
    this.forceReload();
  },

  enable: function()
  {
    Prefs.enabled = true;
    E("issuesDisabledBox").hidden = true;
    this.forceReload();
  },

  addSubscription: function()
  {
    let result = {};
    openDialog("subscriptionSelection.xul", "_blank", "chrome,centerscreen,modal,resizable,dialog=no", null, result);
    if (!("url" in result))
      return;

    let subscriptionResults = [[result.url, result.title]];
    if ("mainSubscriptionURL" in result)
      subscriptionResults.push([result.mainSubscriptionURL, result.mainSubscriptionTitle]);

    for (let [url, title] of subscriptionResults)
    {
      let subscription = Subscription.fromURL(url);
      if (!subscription)
        continue;

      FilterStorage.addSubscription(subscription);

      subscription.disabled = false;
      subscription.title = title;

      if (subscription instanceof DownloadableSubscription && !subscription.lastDownload)
        Synchronizer.execute(subscription);
    }

    E("issuesNoSubscriptionsBox").hidden = true;
    this.forceReload();
  },

  disableFilter: function(node)
  {
    let filter = node.abpFilter;
    if (filter && filter.subscriptions.length)
      filter.disabled = true;

    node.parentNode.removeChild(node);
    if (!E("issuesOwnFilters").firstChild)
      E("issuesOwnFiltersBox").hidden = true;
    this.forceReload();
  },

  enableFilter: function(node)
  {
    let filter = node.abpFilter;
    if (filter && filter.subscriptions.length)
      filter.disabled = false;

    node.parentNode.removeChild(node);
    if (!E("issuesDisabledFilters").firstChild)
      E("issuesDisabledFiltersBox").hidden = true;
    this.forceReload();
  },


  enableSubscription: function(node)
  {
    let subscription = node.abpSubscription;
    if (subscription)
      subscription.disabled = false;

    node.parentNode.removeChild(node);
    if (!E("issuesDisabledSubscriptions").firstChild)
      E("issuesDisabledSubscriptionsBox").hidden = true;
    this.forceReload();
  }
};

let dataCollectors = [reportsListDataSource, requestsDataSource, filtersDataSource, subscriptionsDataSource,
                      remoteDataSource, errorsDataSource, extensionsDataSource,
                      subscriptionUpdateDataSource, issuesDataSource];

//
// Wizard logic
//

function initWizard()
{
  // Make sure no issue type is selected by default
  E("typeGroup").selectedItem = null;
  document.documentElement.addEventListener("pageshow", updateNextButton, false);

  // Move wizard header
  let header = document.getAnonymousElementByAttribute(document.documentElement, "class", "wizard-header");
  if (header)
  {
    document.getElementById("wizardHeaderLabel").setAttribute("value", document.documentElement.wizardPages[0].getAttribute("label"));
    document.documentElement.insertBefore(document.getElementById("wizardHeader"), document.documentElement.firstChild);
    document.documentElement.addEventListener("pageshow", function()
    {
      document.getElementById("wizardHeaderDeck").selectedIndex = (document.documentElement.pageIndex == 0 ? 0 : 1);
    }, false);
  }

  // Move privacy link
  let extraButton = document.documentElement.getButton("extra1");
  extraButton.parentNode.insertBefore(E("privacyLink"), extraButton);
}

function updateNextButton()
{
  let nextButton = document.documentElement.getButton("next");
  if (!nextButton)
    return;

  if (document.documentElement.currentPage.id == "commentPage")
  {
    if (!("_origLabel" in nextButton))
    {
      nextButton._origLabel = nextButton.label;
      nextButton._origAccessKey = nextButton.accessKey;
      [nextButton.label, nextButton.accessKey] = Utils.splitLabel(document.documentElement.getAttribute("sendbuttonlabel"));
    }
  }
  else
  {
    if ("_origLabel" in nextButton)
    {
      nextButton.label = nextButton._origLabel;
      nextButton.accessKey = nextButton._origAccessKey;
      delete nextButton._origLabel;
      delete nextButton._origAccessKey;
    }
  }
}

function initDataCollectorPage()
{
  document.documentElement.canAdvance = false;

  let totalSteps = dataCollectors.length;
  let initNextDataSource = function()
  {
    if (!dataCollectors.length)
    {
      // We are done, continue to next page
      document.documentElement.canAdvance = true;
      document.documentElement.advance();
      return;
    }

    let progress = (totalSteps - dataCollectors.length) / totalSteps * 100;
    if (progress > 0)
    {
      let progressMeter = E("dataCollectorProgress");
      progressMeter.mode = "determined";
      progressMeter.value = progress;
    }

    // Continue with the next data source, asynchronously to allow progress meter to update
    let dataSource = dataCollectors.shift();
    Utils.runAsync(function()
    {
      dataSource.collectData(outerWindowID, windowURI, browser, initNextDataSource);
    });
  };

  initNextDataSource();
}

function initTypeSelectorPage()
{
  E("progressBar").activeItem = E("typeSelectorHeader");
  let header = document.getAnonymousElementByAttribute(document.documentElement, "class", "wizard-header");
  if (header)
    header.setAttribute("viewIndex", "1");

  document.documentElement.canRewind = false;
  typeSelectionUpdated();
}

function typeSelectionUpdated()
{
  let selection = E("typeGroup").selectedItem;
  document.documentElement.canAdvance = (selection != null);
  if (selection)
  {
    if (reportData.documentElement.getAttribute("type") != selection.value)
    {
      E("screenshotCheckbox").checked = (selection.value != "other");
      E("screenshotCheckbox").doCommand();
      E("extensionsCheckbox").checked = (selection.value == "other");
      E("extensionsCheckbox").doCommand();
    }
    reportData.documentElement.setAttribute("type", selection.value);

    issuesDataSource.updateIssues(selection.value);
  }
}

function initIssuesPage()
{
  updateIssuesOverride();
}

function updateIssuesOverride()
{
  document.documentElement.canAdvance = E("issuesOverride").checked;
}

function initTypeWarningPage()
{
  updateTypeWarningOverride();

  let textElement = E("typeWarningText");
  if ("abpInitialized" in textElement)
    return;

  let template = textElement.textContent.replace(/[\r\n\s]+/g, " ");

  let [, beforeLink, linkText, afterLink] = /(.*)\[link\](.*)\[\/link\](.*)/.exec(template) || [null, "", template, ""];
  while (textElement.firstChild && textElement.firstChild.nodeType != Node.ELEMENT_NODE)
    textElement.removeChild(textElement.firstChild);
  while (textElement.lastChild && textElement.lastChild.nodeType != Node.ELEMENT_NODE)
    textElement.removeChild(textElement.lastChild);

  if (textElement.firstChild)
    textElement.firstChild.textContent = linkText;
  textElement.insertBefore(document.createTextNode(beforeLink), textElement.firstChild);
  textElement.appendChild(document.createTextNode(afterLink));
  textElement.abpInitialized = true;
}

function updateTypeWarningOverride()
{
  document.documentElement.canAdvance = E("typeWarningOverride").checked;
}

function initScreenshotPage()
{
  document.documentElement.canAdvance = true;

  E("progressBar").activeItem = E("screenshotHeader");
}

function initCommentPage()
{
  E("progressBar").activeItem = E("commentPageHeader");

  updateEmail();

  screenshotDataSource.exportData();
  updateDataField();
}

function showDataField()
{
  E('dataDeck').selectedIndex = 1;
  updateDataField();
  E('data').focus();
}

let _dataFieldUpdateTimeout = null;

function _updateDataField()
{
  let dataField = E("data");
  let [selectionStart, selectionEnd] = [dataField.selectionStart, dataField.selectionEnd];
  dataField.value = serializeReportData();
  dataField.setSelectionRange(selectionStart, selectionEnd);
}

function updateDataField()
{
  // Don't do anything if data field is hidden
  if (E('dataDeck').selectedIndex != 1)
    return;

  if (_dataFieldUpdateTimeout)
  {
    window.clearTimeout(_dataFieldUpdateTimeout);
    _dataFieldUpdateTimeout = null;
  }

  _dataFieldUpdateTimeout = window.setTimeout(_updateDataField, 200);
}

function updateComment()
{
  removeReportElement("comment");

  let value = E("comment").value;
  appendElement(reportData.documentElement, "comment", null, value.substr(0, 1000));
  E("commentLengthWarning").setAttribute("visible", value.length > 1000);
  updateDataField();
}

function updateEmail()
{
  removeReportElement("email");

  let anonymous = E("anonymousCheckbox").checked;

  let value = E("email").value;

  // required for persist to work on textbox, see: https://bugzilla.mozilla.org/show_bug.cgi?id=111486
  E("email").setAttribute("value", value);

  E("email").disabled = anonymous;
  E("emailLabel").disabled = anonymous;
  E("anonymityWarning").setAttribute("visible", anonymous);

  if (!anonymous)
    appendElement(reportData.documentElement, "email", null, value);

  updateDataField();

  document.documentElement.canAdvance = anonymous || /\S/.test(value);
}

function updateExtensions(attach)
{
  extensionsDataSource.exportData(attach);
  updateDataField();
}

function initSendPage()
{
  E("progressBar").activeItem = E("sendPageHeader");

  E("result").hidden = true;
  E("sendReportErrorBox").hidden = true;
  E("sendReportMessage").hidden = false;
  E("sendReportProgress").hidden = false;
  E("sendReportProgress").mode = "undetermined";

  document.documentElement.canRewind = false;
  document.documentElement.getButton("finish").disabled = true;

  let guid = Cc["@mozilla.org/uuid-generator;1"].getService(Ci.nsIUUIDGenerator).generateUUID().toString().replace(/[\{\}]/g, "");
  let url = Prefs.report_submiturl.replace(/%GUID%/g, guid).replace(/%LANG%/g, Utils.appLocale);
  let request = new XMLHttpRequest();
  request.open("POST", url);
  request.setRequestHeader("Content-Type", "text/xml");
  request.setRequestHeader("X-Adblock-Plus", "1");
  request.addEventListener("load", reportSent, false);
  request.addEventListener("error", reportSent, false);
  if ("upload" in request && request.upload)
    request.upload.addEventListener("progress", updateReportProgress, false);
  request.send(serializeReportData());
}

function updateReportProgress(event)
{
  if (!event.lengthComputable)
    return;

  let progress = Math.round(event.loaded / event.total * 100);
  if (progress > 0)
  {
    let progressMeter = E("sendReportProgress");
    progressMeter.mode = "determined";
    progressMeter.value = progress;
  }
}

function reportSent(event)
{
  let request = event.target;
  let success = false;
  let errorMessage = E("sendReportError").getAttribute("defaultError");
  try
  {
    let status = request.channel.status;
    if (Components.isSuccessCode(status))
    {
      success = (request.status == 200 || request.status == 0);
      errorMessage = request.status + " " + request.statusText;
    }
    else
    {
      errorMessage = "0x" + status.toString(16);

      // Try to find the name for the status code
      let exception = Cc["@mozilla.org/js/xpc/Exception;1"].createInstance(Ci.nsIXPCException);
      exception.initialize(null, status, null, null, null, null);
      if (exception.name)
        errorMessage = exception.name;
    }
  } catch (e) {}

  let result = "";
  try
  {
    result = request.responseText;
  } catch (e) {}

  result = result.replace(/%CONFIRMATION%/g, encodeHTML(E("result").getAttribute("confirmationMessage")));
  result = result.replace(/%KNOWNISSUE%/g, encodeHTML(E("result").getAttribute("knownIssueMessage")));
  result = result.replace(/(<html)\b/, '$1 dir="' + window.getComputedStyle(document.documentElement, "").direction + '"');

  if (!success)
  {
    let errorElement = E("sendReportError");
    let template = errorElement.getAttribute("textTemplate").replace(/[\r\n\s]+/g, " ");

    let [, beforeLink, linkText, afterLink] = /(.*)\[link\](.*)\[\/link\](.*)/.exec(template) || [null, "", template, ""];
    beforeLink = beforeLink.replace(/\?1\?/g, errorMessage);
    afterLink = afterLink.replace(/\?1\?/g, errorMessage);

    while (errorElement.firstChild && errorElement.firstChild.nodeType != Node.ELEMENT_NODE)
      errorElement.removeChild(errorElement.firstChild);
    while (errorElement.lastChild && errorElement.lastChild.nodeType != Node.ELEMENT_NODE)
      errorElement.removeChild(errorElement.lastChild);

    if (errorElement.firstChild)
      errorElement.firstChild.textContent = linkText;
    errorElement.insertBefore(document.createTextNode(beforeLink), errorElement.firstChild);
    errorElement.appendChild(document.createTextNode(afterLink));

    E("sendReportErrorBox").hidden = false;
  }

  E("sendReportProgress").hidden = true;

  let frame = E("result");
  frame.hidden = false;
  frame.docShell.allowAuth = false;
  frame.docShell.allowJavascript = false;
  frame.docShell.allowMetaRedirects = false;
  frame.docShell.allowPlugins = false;
  frame.docShell.allowSubframes = false;

  frame.setAttribute("src", "data:text/html;charset=utf-8," + encodeURIComponent(result));

  E("sendReportMessage").hidden = true;

  if (success)
  {
    try
    {
      let link = request.responseXML.getElementById("link").getAttribute("href");
      let button = E("copyLink");
      button.setAttribute("url", link);
      button.removeAttribute("disabled");

      if (!isPrivate)
        reportsListDataSource.addReport(framesDataSource.site, link);
    } catch (e) {}
    E("copyLinkBox").hidden = false;

    document.documentElement.getButton("finish").disabled = false;
    document.documentElement.getButton("cancel").disabled = true;
    E("progressBar").activeItemComplete = true;
  }
}

function processLinkClick(event)
{
  if (event.button != 0)
    return;

  event.preventDefault();

  let link = event.target;
  while (link && !(link instanceof HTMLAnchorElement))
    link = link.parentNode;

  if (link && (link.protocol == "http:" || link.protocol == "https:"))
    UI.loadInBrowser(link.href);
}

function copyLink(url)
{
  Utils.clipboardHelper.copyString(url);
}

function censorURL(url)
{
  return url.replace(/([?;&\/#][^?;&\/#]+?=)[^?;&\/#]+/g, "$1*");
}

function encodeHTML(str)
{
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
