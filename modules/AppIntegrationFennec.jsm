/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

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
Cu.import(baseURL.spec + "FilterNotifier.jsm");
Cu.import(baseURL.spec + "FilterClasses.jsm");
Cu.import(baseURL.spec + "SubscriptionClasses.jsm");
Cu.import(baseURL.spec + "Synchronizer.jsm");
Cu.import(baseURL.spec + "Sync.jsm");
Cu.import(baseURL.spec + "AppIntegration.jsm");

let PolicyPrivate = Cu.import(baseURL.spec + "ContentPolicy.jsm", null).PolicyPrivate;

/**
 * Fake DOM window class, useful when information received from a remote process
 * needs to be passed on to the content policy.
 * @constructor
 */
function FakeWindow(/**String*/ location, /**FakeNode*/ document, /**FakeWindow*/ parent, /**FakeWindow*/ top)
{
  this._location = location;
  this._parent = (parent || this);
  this._top = (top || this);
  this.document = document;
}
FakeWindow.prototype =
{
  get location() this,
  get href() this._location,
  get parent() this._parent,
  get top() this._top
}

/**
 * Fake DOM node class, useful when information received from a remote process
 * needs to be passed on to the content policy.
 * @constructor
 */
function FakeNode(/**String[]*/ locations)
{
  let parentWindow = null;
  let topWindow = null;
  while (locations.length)
  {
    let wnd = new FakeWindow(locations.pop(), this, parentWindow, topWindow);
    parentWindow = wnd;
    if (!topWindow)
      topWindow = wnd;
  }
  this.defaultView = parentWindow;
}
FakeNode.prototype =
{
  defaultView: null,
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
      let fakeNode = new FakeNode(data.locations);
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

      let fakeNode = new FakeNode(data.locations);
      return !Policy.processNode(fakeNode.defaultView, fakeNode, Policy.type.ELEMHIDE, filter);
    }
    catch (e)
    {
      Cu.reportError(e);
    }

    return ElemHide.styleURL;
  });

  // Trigger update in child processes if elemhide stylesheet or matcher data change
  FilterNotifier.addListener(function(action)
  {
    if (action == "elemhideupdate")
      Utils.parentMessageManager.sendAsyncMessage("AdblockPlus:ElemHide:updateStyleURL", ElemHide.styleURL);
    else if (/^(filter|subscription)\.(added|removed|disabled|updated)$/.test(action))
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
    wrapper.updateState = function() {};
    wrapper.updateState.isDummy = true;

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

  wrapper.E("adblockplus-acceptableAds").addEventListener("command", function(event)
  {
    allowAcceptableAds(event.target.value);
  }, false);

  let syncSetting = wrapper.E("adblockplus-sync");
  let syncEngine = Sync.getEngine();
  syncSetting.hidden = !syncEngine;
  syncSetting.value = syncEngine && syncEngine.enabled;
  syncSetting.addEventListener("command", AppIntegration.toggleSync, false);

  let updateFunction = function(action, items)
  {
    if (/^subscription\b/.test(action))
      updateSubscriptionList(wrapper);
  }
  updateFunction("subscription");
  FilterNotifier.addListener(updateFunction);

  wrapper.window.addEventListener("unload", function()
  {
    FilterNotifier.removeListener(updateFunction);
  }, false);
}

function updateSubscriptionList(wrapper)
{
  let hasAcceptableAds = FilterStorage.subscriptions.some(function(subscription) subscription instanceof DownloadableSubscription && subscription.url == Prefs.subscriptions_exceptionsurl);
  wrapper.E("adblockplus-acceptableAds").value = hasAcceptableAds;

  let currentSubscription = FilterStorage.subscriptions.filter(
    function(subscription) subscription instanceof DownloadableSubscription && subscription.url != Prefs.subscriptions_exceptionsurl
  );
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
  let currentSubscription = FilterStorage.subscriptions.filter(
    function(subscription) subscription instanceof DownloadableSubscription && subscription.url != Prefs.subscriptions_exceptionsurl
  );
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
}

function allowAcceptableAds(/**Boolean*/ allow)
{
  let subscription = Subscription.fromURL(Prefs.subscriptions_exceptionsurl);
  if (!subscription)
    return;

  subscription.disabled = false;
  subscription.title = "Allow non-intrusive advertising";
  if (allow)
  {
    FilterStorage.addSubscription(subscription);
    if (subscription instanceof DownloadableSubscription && !subscription.lastDownload)
      Synchronizer.execute(subscription);
  }
  else
    FilterStorage.removeSubscription(subscription);
}

function updateFennecStatusUI(wrapper)
{
  let siteInfo = wrapper.E("abp-site-info");
  siteInfo.addEventListener("click", toggleFennecWhitelist, false);
  siteInfo.setAttribute("hidden", "true");

  let action;
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
    if (!host)
      return;

    if (host && Policy.isWhitelisted(location.spec))
      action = "enable_site";
    else if (host)
      action = "disable_site";
  }
  else
    action = "enable";

  let actionText = Utils.getString("mobile_menu_" + action);
  if (host)
    actionText = actionText.replace(/\?1\?/g, host);

  siteInfo.removeAttribute("hidden");
  siteInfo.setAttribute("title", actionText);
  siteInfo.setAttribute("abpaction", action);
}

function toggleFennecWhitelist(event)
{
  if (!Prefs.enabled)
  {
    Prefs.enabled = true;
    return;
  }

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
