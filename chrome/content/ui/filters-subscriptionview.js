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
 * Portions created by the Initial Developer are Copyright (C) 2006-2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

/**
 * Fills a list of filter groups and keeps it updated.
 * @param {Element} list  richlistbox element to be filled
 * @param {Node} template  template to use for the groups
 * @param {Function} filter  filter to decide which lists should be included
 * @param {Function} listener  function to be called on changes
 * @constructor
 */
function ListManager(list, template, filter, listener)
{
  this._list = list;
  this._template = template;
  this._filter = filter;
  this._listener = listener || function(){};

  this._placeholder = this._list.firstChild;
  this._list.removeChild(this._placeholder);

  this._list.listManager = this;
  this.reload();

  let me = this;
  let proxy = function()
  {
    return me._onChange.apply(me, arguments);
  };
  FilterNotifier.addListener(proxy);
  window.addEventListener("unload", function()
  {
    FilterNotifier.removeListener(proxy);
  }, false);
}
ListManager.prototype =
{
  /**
   * List element being managed.
   * @type Element
   */
  _list: null,
  /**
   * Template used for the groups.
   * @type Node
   */
  _template: null,
  /**
   * Filter function to decide which subscriptions should be included.
   * @type Function
   */
  _filter: null,
  /**
   * Function to be called whenever list contents change.
   * @type Function
   */
  _listener: null,
  /**
   * Entry to display if the list is empty (if any).
   * @type Element
   */
  _placeholder: null,

  /**
   * Completely rebuilds the list.
   */
  reload: function()
  {
    // Remove existing entries if any
    while (this._list.firstChild)
      this._list.removeChild(this._list.firstChild);

    // Now add all subscriptions
    let subscriptions = FilterStorage.subscriptions.filter(this._filter, this);
    if (subscriptions.length)
    {
      for each (let subscription in subscriptions)
        this.addSubscription(subscription, null);

      // Make sure first list item is selected after list initialization
      Utils.runAsync(function()
      {
        this._list.selectItem(this._list.getItemAtIndex(this._list.getIndexOfFirstVisibleRow()));
      }, this);
    }
    else if (this._placeholder)
      this._list.appendChild(this._placeholder);
    this._listener();
  },

  /**
   * Adds a filter subscription to the list.
   */
  addSubscription: function(/**Subscription*/ subscription, /**Node*/ insertBefore) /**Node*/
  {
    let node = Templater.process(this._template, {
      __proto__: null,
      subscription: subscription,
      isExternal: subscription instanceof ExternalSubscription,
      downloading: Synchronizer.isExecuting(subscription.url),
      disabledFilters: 0
    });
    if (insertBefore)
      this._list.insertBefore(node, insertBefore);
    else
      this._list.appendChild(node);
    return node;
  },

  /**
   * Subscriptions change processing.
   * @see FilterNotifier.addListener()
   */
  _onChange: function(action, item, param1, param2)
  {
    if ((action == "subscription.added" || action == "subscription.removed") && item.url == Prefs.subscriptions_exceptionsurl)
      E("acceptableAds").checked = FilterStorage.subscriptions.some(function(s) s.url == Prefs.subscriptions_exceptionsurl);

    if (action != "load" && !this._filter(item))
      return;

    switch (action)
    {
      case "load":
      {
        this.reload();
        break;
      }
      case "subscription.added":
      {
        let index = FilterStorage.subscriptions.indexOf(item);
        if (index >= 0)
        {
          let insertBefore = null;
          for (index++; index < FilterStorage.subscriptions.length && !insertBefore; index++)
            insertBefore = Templater.getNodeForData(this._list, "subscription", FilterStorage.subscriptions[index]);
          this.addSubscription(item, insertBefore);
          if (this._placeholder.parentNode)
            this._placeholder.parentNode.removeChild(this._placeholder);
          this._listener();
        }
        break;
      }
      case "subscription.removed":
      {
        let node = Templater.getNodeForData(this._list, "subscription", item);
        if (node)
        {
          let newSelection = node.nextSibling || node.previousSibling;
          node.parentNode.removeChild(node);
          if (!this._list.firstChild)
          {
            this._list.appendChild(this._placeholder);
            this._list.selectedItem = this._placeholder;
          }
          else if (newSelection)
          {
            this._list.ensureElementIsVisible(newSelection);
            this._list.selectedItem = newSelection;
          }
          this._listener();
        }
        break
      }
      case "subscription.moved":
      {
        let node = Templater.getNodeForData(this._list, "subscription", item);
        if (node)
        {
          node.parentNode.removeChild(node);
          let insertBefore = null;
          let index = FilterStorage.subscriptions.indexOf(item);
          if (index >= 0)
            for (index++; index < FilterStorage.subscriptions.length && !insertBefore; index++)
              insertBefore = Templater.getNodeForData(this._list, "subscription", FilterStorage.subscriptions[index]);
          this._list.insertBefore(node, insertBefore);
          this._list.ensureElementIsVisible(node);
          this._listener();
        }
        break;
      }
      case "subscription.title":
      case "subscription.disabled":
      case "subscription.homepage":
      case "subscription.lastDownload":
      case "subscription.downloadStatus":
      {
        let subscriptionNode = Templater.getNodeForData(this._list, "subscription", item);
        if (subscriptionNode)
        {
          Templater.getDataForNode(subscriptionNode).downloading = Synchronizer.isExecuting(item.url);
          Templater.update(this._template, subscriptionNode);

          if (!document.commandDispatcher.focusedElement)
            this._list.focus();
          this._listener();
        }
        break;
      }
    }
  }
};

/**
 * Attaches list managers to the lists.
 */
ListManager.init = function()
{
  new ListManager(E("subscriptions"),
                  E("subscriptionTemplate"),
                  function(s) s instanceof RegularSubscription && !(ListManager.acceptableAdsCheckbox && s.url == Prefs.subscriptions_exceptionsurl),
                  SubscriptionActions.updateCommands);
  new ListManager(E("groups"),
                  E("groupTemplate"),
                  function(s) s instanceof SpecialSubscription,
                  SubscriptionActions.updateCommands);
  E("acceptableAds").checked = FilterStorage.subscriptions.some(function(s) s.url == Prefs.subscriptions_exceptionsurl);
  E("acceptableAds").parentNode.hidden = !ListManager.acceptableAdsCheckbox;
};

/**
 * Defines whether the "acceptable ads" subscription needs special treatment.
 * @type Boolean
 */
ListManager.acceptableAdsCheckbox = Prefs.subscriptions_exceptionscheckbox;

/**
 * Adds or removes filter subscription allowing acceptable ads.
 */
ListManager.allowAcceptableAds = function(/**Boolean*/ allow)
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
  FilterStorage.saveToDisk();
};

window.addEventListener("load", ListManager.init, false);
