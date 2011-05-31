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
 * @fileOverview Code specific to integration into Fennec.
 */

var EXPORTED_SYMBOLS = ["AppIntegrationFennec"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

let baseURL = Cc["@adblockplus.org/abp/private;1"].getService(Ci.nsIURI);

Cu.import(baseURL.spec + "Utils.jsm");
Cu.import(baseURL.spec + "Prefs.jsm");
Cu.import(baseURL.spec + "ContentPolicy.jsm");
Cu.import(baseURL.spec + "ElemHide.jsm");
Cu.import(baseURL.spec + "FilterStorage.jsm");
Cu.import(baseURL.spec + "FilterClasses.jsm");
Cu.import(baseURL.spec + "SubscriptionClasses.jsm");
Cu.import(baseURL.spec + "Synchronizer.jsm");
Cu.import(baseURL.spec + "Sync.jsm");
Utils.runAsync(Cu.import, Cu, baseURL.spec + "AppIntegration.jsm"); // delay to avoid circular imports

let PolicyPrivate = Cu.import(baseURL.spec + "ContentPolicy.jsm", null).PolicyPrivate;

/**
 * Fake DOM window class, useful when information received from a remote process
 * needs to be passed on to the content policy.
 * @constructor
 */
function FakeWindow(/**String*/ location, /**FakeNode*/ document, /**FakeWindow*/ top)
{
  this._location = location;
  this._top = top;
  this.document = document;
}
FakeWindow.prototype =
{
  get location() this,
  get href() this._location,
  get top() this._top || this
}

/**
 * Fake DOM node class, useful when information received from a remote process
 * needs to be passed on to the content policy.
 * @constructor
 */
function FakeNode(/**String*/ wndLocation, /**String*/ topLocation)
{
  let topWnd = new FakeWindow(topLocation, this, null);
  this.defaultView = new FakeWindow(wndLocation, this, topWnd);
}
FakeNode.prototype =
{
  get ownerDocument() this,
  getUserData: function() {return null},
  setUserData: function() {}
}

let needPostProcess = false;

/**
 * Function temporarily replacing Utils.schedulePostProcess() function, will set
 * needPostProcess variable instead of actually scheduling post-processing (for
 * the case that post-processing has to be done in a remote process).
 */
function postProcessReplacement(node)
{
  needPostProcess = true;
}

try
{
  Utils.parentMessageManager.addMessageListener("AdblockPlus:Policy:shouldLoad", function(message)
  {
    // Replace Utils.schedulePostProcess() to learn whether our node is scheduled for post-processing
    let oldPostProcess = Utils.schedulePostProcess;
    needPostProcess = false;
    Utils.schedulePostProcess = postProcessReplacement;

    try
    {
      let data = message.json;
      let fakeNode = new FakeNode(data.wndLocation, data.topLocation);
      let result = PolicyPrivate.shouldLoad(data.contentType, data.contentLocation, null, fakeNode);
      return {value: result, postProcess: needPostProcess};
    }
    catch (e)
    {
      Cu.reportError(e);
    }
    finally
    {
      Utils.schedulePostProcess = oldPostProcess;
    }
  });

  Utils.parentMessageManager.addMessageListener("AdblockPlus:ElemHide:styleURL", function(message)
  {
    return ElemHide.styleURL;
  });

  Utils.parentMessageManager.addMessageListener("AdblockPlus:ElemHide:checkHit", function(message)
  {
    try
    {
      let data = message.json;
      let filter = ElemHide.getFilterByKey(data.key);
      if (!filter)
        return false;

      let fakeNode = new FakeNode(data.wndLocation, data.topLocation);
      return !Policy.processNode(fakeNode.defaultView, fakeNode, Policy.type.ELEMHIDE, filter);
    }
    catch (e)
    {
      Cu.reportError(e);
    }

    return ElemHide.styleURL;
  });

  // Trigger update in child processes if elemhide stylesheet or matcher data change
  FilterStorage.addObserver(function(action)
  {
    if (action == "elemhideupdate")
      Utils.parentMessageManager.sendAsyncMessage("AdblockPlus:ElemHide:updateStyleURL", ElemHide.styleURL);
    else if (/^(filters|subscriptions) (add|remove|enable|disable|update)$/.test(action))
      Utils.parentMessageManager.sendAsyncMessage("AdblockPlus:Matcher:clearCache");
  });

  // Trigger update in child processes if enable or fastcollapse preferences change
  Prefs.addListener(function(name)
  {
    if (name == "enabled" || name == "fastcollapse")
      Utils.parentMessageManager.sendAsyncMessage("AdblockPlus:Matcher:clearCache");
  });
} catch(e) {}   // Ignore errors if we are not running in a multi-process setup


/**
 * Fennec-specific app integration functions.
 * @class
 */
var AppIntegrationFennec =
{
  initWindow: function(wrapper)
  {
    if ("messageManager" in wrapper.window)
    {
      // Multi-process setup - we need to inject our content script into all tabs
      let browsers = wrapper.window.Browser.browsers;
      for (let i = 0; i < browsers.length; i++)
        browsers[i].messageManager.loadFrameScript("chrome://adblockplus/content/fennecContent.js", true);
      wrapper.E("tabs").addEventListener("TabOpen", function(event)
      {
        let tab = wrapper.window.Browser.getTabFromChrome(event.originalTarget);
        tab.browser.messageManager.loadFrameScript("chrome://adblockplus/content/fennecContent.js", true);
      }, false);

      // Get notified about abp: link clicks for this window
      wrapper.window.messageManager.addMessageListener("AdblockPlus:LinkClick", function(message)
      {
        wrapper.handleLinkClick(null, message.json);
      });
    }

    if (typeof wrapper.window.IdentityHandler == "function" && typeof wrapper.window.IdentityHandler.prototype.show == "function")
    {
      // HACK: Hook IdentityHandler.show() to init our UI
      let oldShow = wrapper.window.IdentityHandler.prototype.show;
      wrapper.window.IdentityHandler.prototype.show = function()
      {
        try
        {
          updateFennecStatusUI(wrapper);
        }
        finally
        {
          oldShow.apply(this, arguments);
        }
      }
    }
    
    wrapper.E("addons-list").addEventListener("AddonOptionsLoad", function(event)
    {
      onCreateOptions(wrapper, event)
    }, false);
  },

  openFennecSubscriptionDialog: function(/**WindowWrapper*/ wrapper, /**String*/ url, /**String*/ title)
  {
    wrapper.window.importDialog(null, "chrome://adblockplus/content/ui/fennecSubscription.xul");
  
    // Copied from Fennec's PromptService.js
    // add a width style to prevent a element to grow larger 
    // than the screen width
    function sizeElement(id, percent)
    {
      let elem = wrapper.E(id);
      let screenW = wrapper.E("main-window").getBoundingClientRect().width;
      elem.style.width = screenW * percent / 100 + "px"
    }
    
    // size the height of the scrollable message. this assumes the given element
    // is a child of a scrollbox
    function sizeScrollableMsg(id, percent)
    {
      let screenH = wrapper.E("main-window").getBoundingClientRect().height;
      let maxHeight = screenH * percent / 100;
      
      let elem = wrapper.E(id);
      let style = wrapper.window.getComputedStyle(elem, null);
      let height = Math.ceil(elem.getBoundingClientRect().height) +
                   parseInt(style.marginTop) +
                   parseInt(style.marginBottom);
    
      if (height > maxHeight)
        height = maxHeight;
      elem.parentNode.style.height = height + "px";
    }
  
    sizeElement("abp-subscription-title", 50);
    wrapper.E("abp-subscription-title").textContent = title;
  
    sizeElement("abp-subscription-url", 50);
    wrapper.E("abp-subscription-url").textContent = url;
    sizeScrollableMsg("abp-subscription-url", 50);
  
    wrapper.E("abp-subscription-cmd-ok").addEventListener("command", function()
    {
      setSubscription(url, title);
      wrapper.E("abpEditSubscription").close();
    }, false);
  
    wrapper.E("abp-subscription-btn-ok").focus();
  }
};

function onCreateOptions(wrapper, event)
{
  if (event.originalTarget.getAttribute("addonID") != "{d10d0bf8-f5b5-c8b4-a8b2-2b9879e08c5d}")
    return;

  wrapper.E("adblockplus-subscription-list").addEventListener("command", function(event)
  {
    let menu = event.target;
    if (menu.value)
      setSubscription(menu.value, menu.label);
  }, false);

  let syncSetting = wrapper.E("adblockplus-sync");
  let syncEngine = Sync.getEngine();
  syncSetting.hidden = !syncEngine;
  syncSetting.value = syncEngine.enabled;
  wrapper.E("adblockplus-sync").addEventListener("command", AppIntegration.toggleSync, false);

  let updateFunction = function(action, items)
  {
    if (/^subscriptions\b/.test(action))
      updateSubscriptionList(wrapper);
  }
  updateFunction("subscriptions");
  FilterStorage.addObserver(updateFunction);

  wrapper.window.addEventListener("unload", function()
  {
    FilterStorage.removeObserver(updateFunction);
  }, false);
}

function updateSubscriptionList(wrapper)
{
  let currentSubscription = FilterStorage.subscriptions.filter(function(subscription) subscription instanceof DownloadableSubscription);
  currentSubscription = (currentSubscription.length ? currentSubscription[0] : null);
  
  let xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIJSXMLHttpRequest);
  xhr.open("GET", "chrome://adblockplus/content/ui/subscriptions.xml", false);
  xhr.send(null);
  if (!xhr.responseXML)
    return;

  let menu = wrapper.E("adblockplus-subscription-list");
  menu.removeAllItems();

  let subscriptions = xhr.responseXML.documentElement.getElementsByTagName("subscription");
  for (let i = 0; i < subscriptions.length; i++)
  {
    let item = subscriptions[i];
    let url = item.getAttribute("url");
    if (!url)
      continue;

    menu.appendItem(item.getAttribute("title"), url, null);
    if (currentSubscription && url == currentSubscription.url)
      menu.selectedIndex = menu.itemCount - 1;
  }

  if (currentSubscription && menu.selectedIndex < 0)
  {
    menu.appendItem(currentSubscription.title, currentSubscription.url, null);
    menu.selectedIndex = menu.itemCount - 1;
  }
}
  
function setSubscription(url, title)
{
  let currentSubscription = FilterStorage.subscriptions.filter(function(subscription) subscription instanceof DownloadableSubscription);
  currentSubscription = (currentSubscription.length ? currentSubscription[0] : null);
  if (currentSubscription && currentSubscription.url == url)
    return;

  // We only allow one subscription, remove existing one before adding
  if (currentSubscription)
    FilterStorage.removeSubscription(currentSubscription);

  currentSubscription = Subscription.fromURL(url);
  currentSubscription.title = title;

  FilterStorage.addSubscription(currentSubscription);
  Synchronizer.execute(currentSubscription, false);
  FilterStorage.saveToDisk();
}

function updateFennecStatusUI(wrapper)
{
  let siteInfo = wrapper.E("abp-site-info");
  siteInfo.addEventListener("click", toggleFennecWhitelist, false);

  let status = "disabled";
  let host = null;
  if (Prefs.enabled)
  {
    status = "enabled";
    let location = wrapper.getCurrentLocation();
    if (location instanceof Ci.nsIURL && Policy.isBlockableScheme(location))
    {
      try
      {
        host = location.host.replace(/^www\./, "");
      } catch (e) {}
    }

    if (host && Policy.isWhitelisted(location.spec))
      status = "disabled_site";
    else if (host)
      status = "enabled_site";
  }

  let statusText = Utils.getString("fennec_status_" + status);
  if (host)
    statusText = statusText.replace(/\?1\?/g, host);

  siteInfo.setAttribute("title", statusText);
  siteInfo.setAttribute("abpstate", status);
}

function toggleFennecWhitelist(event)
{
  if (!Prefs.enabled)
    return;

  let wrapper = AppIntegration.getWrapperForWindow(event.target.ownerDocument.defaultView);
  let location = wrapper.getCurrentLocation();
  let host = null;
  if (location instanceof Ci.nsIURL && Policy.isBlockableScheme(location))
  {
    try
    {
      host = location.host.replace(/^www\./, "");
    } catch (e) {}
  }

  if (!host)
    return;

  if (Policy.isWhitelisted(location.spec))
    wrapper.removeWhitelist();
  else
    AppIntegration.toggleFilter(Filter.fromText("@@||" + host + "^$document"));

  updateFennecStatusUI(wrapper);
}
