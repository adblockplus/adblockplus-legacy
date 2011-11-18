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
 * Initialization function, called when the window is loaded.
 */
function init()
{
  new ListManager(E("subscriptions"), E("subscriptionTemplate"), RegularSubscription, SubscriptionActions.updateCommands);
  new ListManager(E("groups"), E("groupTemplate"), SpecialSubscription, SubscriptionActions.updateCommands);
  E("filtersTree").view = FiltersView;
}

/**
 * Called whenever the currently selected tab changes.
 */
function onTabChange(/**Element*/ tabbox)
{
  SubscriptionActions.updateCommands();
  updateSelectedSubscription();

  Utils.runAsync(function()
  {
    let panel = tabbox.selectedPanel;
    if (panel)
      panel.getElementsByClassName("initialFocus")[0].focus();
  });
}

/**
 * Called whenever the selected subscription changes.
 */
function onSelectionChange(/**Element*/ list)
{
  SubscriptionActions.updateCommands();
  updateSelectedSubscription();
  list.focus();

  // Take elements of the previously selected item out of the tab order
  if ("previousSelection" in list && list.previousSelection)
  {
    let elements = list.previousSelection.getElementsByClassName("tabable");
    for (let i = 0; i < elements.length; i++)
      elements[i].setAttribute("tabindex", "-1");
  }
  // Put elements of the selected item into tab order
  if (list.selectedItem)
  {
    let elements = list.selectedItem.getElementsByClassName("tabable");
    for (let i = 0; i < elements.length; i++)
      elements[i].removeAttribute("tabindex");
  }
  list.previousSelection = list.selectedItem;
}

/**
 * Called whenever the filters list is shown/hidden.
 */
function onShowHideFilters()
{
  if (FiltersView.visible)
    FiltersView.refresh();
}

/**
 * Updates filter list when selected subscription changes.
 */
function updateSelectedSubscription()
{
  let panel = E("tabs").selectedPanel;
  if (!panel)
    return;

  let list = panel.getElementsByTagName("richlistbox")[0];
  if (!list)
    return;

  let data = Templater.getDataForNode(list.selectedItem);
  FiltersView.subscription = (data ? data.subscription : null);
}

/**
 * Template processing functions.
 * @class
 */
var Templater =
{
  /**
   * Processes a template node using given data object.
   */
  process: function(/**Node*/ template, /**Object*/ data) /**Node*/
  {
    // Use a sandbox to resolve attributes (for convenience, not security)
    let sandbox = Cu.Sandbox(window);
    for (let key in data)
      sandbox[key] = data[key];
    sandbox.formatTime = Utils.formatTime;

    // Clone template but remove id/hidden attributes from it
    let result = template.cloneNode(true);
    result.removeAttribute("id");
    result.removeAttribute("hidden");
    result._data = data;

    // Resolve any attributes of the for attr="{obj.foo}"
    let conditionals = [];
    let nodeIterator = document.createNodeIterator(result, NodeFilter.SHOW_ELEMENT, null, false);
    for (let node = nodeIterator.nextNode(); node; node = nodeIterator.nextNode())
    {
      if (node.localName == "if")
        conditionals.push(node);
      for (let i = 0; i < node.attributes.length; i++)
      {
        let attribute = node.attributes[i];
        let len = attribute.value.length;
        if (len >= 2 && attribute.value[0] == "{" && attribute.value[len - 1] == "}")
          attribute.value = Cu.evalInSandbox(attribute.value.substr(1, len - 2), sandbox);
      }
    }

    // Process <if> tags - remove if condition is false, replace by their children
    // if it is true
    for each (let node in conditionals)
    {
      let fragment = document.createDocumentFragment();
      let condition = node.getAttribute("condition");
      if (condition == "false")
        condition = false;
      for (let i = 0; i < node.childNodes.length; i++)
      {
        let child = node.childNodes[i];
        if (child.localName == "elif" || child.localName == "else")
        {
          if (condition)
            break;
          condition = (child.localName == "elif" ? child.getAttribute("condition") : true);
          if (condition == "false")
            condition = false;
        }
        else if (condition)
          fragment.appendChild(node.childNodes[i--]);
      }
      node.parentNode.replaceChild(fragment, node);
    }

    return result;
  },

  /**
   * Updates first child of a processed template if the underlying data changed.
   */
  update: function(/**Node*/ template, /**Node*/ node)
  {
    if (!("_data" in node))
      return;
    let newChild = Templater.process(template.firstChild, node._data);
    delete newChild._data;
    node.replaceChild(newChild, node.firstChild);
  },

  /**
   * Walks up the parent chain for a node until the node corresponding with a
   * template is found.
   */
  getDataNode: function(/**Node*/ node) /**Node*/
  {
    while (node)
    {
      if ("_data" in node)
        return node;
      node = node.parentNode;
    }
    return null;
  },

  /**
   * Returns the data used to generate the node from a template.
   */
  getDataForNode: function(/**Node*/ node) /**Object*/
  {
    node = Templater.getDataNode(node);
    if (node)
      return node._data;
    else
      return null;
  },

  /**
   * Returns a node that has been generated from a template using a particular
   * data object.
   */
  getNodeForData: function(/**Node*/ parent, /**String*/ property, /**Object*/ data) /**Node*/
  {
    for (let child = parent.firstChild; child; child = child.nextSibling)
      if ("_data" in child && property in child._data && child._data[property] == data)
        return child;
    return null;
  }
};

/**
 * Fills a list of filter groups and keeps it updated.
 * @param {Element} list  richlistbox element to be filled
 * @param {Node} template  template to use for the groups
 * @param {Object} classFilter  base class of the groups to display
 * @param {Function} listener  function to be called on changes
 * @constructor
 */
function ListManager(list, template, classFilter, listener)
{
  this._list = list;
  this._template = template;
  this._classFilter = classFilter;
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
   * Base class of the groups to display.
   */
  _classFilter: null,
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
    let subscriptions = FilterStorage.subscriptions.filter(function(subscription) subscription instanceof this._classFilter, this);
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
      downloading: Synchronizer.isExecuting(subscription.url)
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
    if (!(item instanceof this._classFilter))
      return;

    switch (action)
    {
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
 * Implemetation of the various actions that can be performed on subscriptions.
 * @class
 */
var SubscriptionActions =
{
  /**
   * Returns the subscription list currently having focus if any.
   * @type Element
   */
  get focusedList()
  {
    let focused = document.commandDispatcher.focusedElement;
    while (focused)
    {
      if ("listManager" in focused)
        return focused;
      focused = focused.parentNode;
    }
    return null;
  },

  /**
   * Returns the currently selected and focused subscription item if any.
   * @type Element
   */
  get selectedItem()
  {
    let list = this.focusedList;
    return (list ? list.selectedItem : null);
  },

  /**
   * Updates subscription commands whenever the selected subscription changes.
   * Note: this method might be called with a wrong "this" value.
   */
  updateCommands: function()
  {
    let node = SubscriptionActions.selectedItem;
    let data = Templater.getDataForNode(node);
    let subscription = (data ? data.subscription : null)
    E("subscription-update-command").setAttribute("disabled", !subscription ||
        !(subscription instanceof DownloadableSubscription) ||
        Synchronizer.isExecuting(subscription.url));
    E("subscription-moveUp-command").setAttribute("disabled", !subscription ||
        !node || !node.previousSibling || !!node.previousSibling.id);
    E("subscription-moveDown-command").setAttribute("disabled", !subscription ||
        !node || !node.nextSibling || !!node.nextSibling.id);
  },

  /**
   * Starts title editing for the selected subscription.
   */
  editTitle: function()
  {
    let node = this.selectedItem;
    if (node)
      TitleEditor.start(node);
  },

  /**
   * Triggers re-download of a filter subscription.
   */
  updateFilters: function(/**Node*/ node)
  {
    let data = Templater.getDataForNode(node || this.selectedItem);
    if (data && data.subscription instanceof DownloadableSubscription)
      Synchronizer.execute(data.subscription, true, true);
  },

  /**
   * Sets Subscription.disabled field to a new value.
   */
  setDisabled: function(/**Element*/ node, /**Boolean*/ value)
  {
    let data = Templater.getDataForNode(node || this.selectedItem);
    if (data)
      data.subscription.disabled = value;
  },

  /**
   * Removes a filter subscription from the list (after a warning).
   */
  remove: function(/**Node*/ node)
  {
    let data = Templater.getDataForNode(node || this.selectedItem);
    if (data && Utils.confirm(window, Utils.getString("remove_subscription_warning")))
      FilterStorage.removeSubscription(data.subscription);
  },

  /**
   * Adds a new filter group and allows the user to change its title.
   */
  addGroup: function()
  {
    let subscription = SpecialSubscription.create();
    FilterStorage.addSubscription(subscription);

    let list = E("groups");
    let node = Templater.getNodeForData(list, "subscription", subscription);
    if (node)
    {
      list.focus();
      list.ensureElementIsVisible(node);
      list.selectedItem = node;
      this.editTitle();
    }
  },

  /**
   * Moves a filter subscription one line up.
   */
  moveUp: function(/**Node*/ node)
  {
    node = Templater.getDataNode(node || this.selectedItem);
    let data = Templater.getDataForNode(node);
    if (!data)
      return;

    let previousData = Templater.getDataForNode(node.previousSibling);
    if (!previousData)
      return;

    FilterStorage.moveSubscription(data.subscription, previousData.subscription);
  },

  /**
   * Moves a filter subscription one line down.
   */
  moveDown: function(/**Node*/ node)
  {
    node = Templater.getDataNode(node || this.selectedItem);
    let data = Templater.getDataForNode(node);
    if (!data)
      return;

    let nextNode = node.nextSibling;
    if (!Templater.getDataForNode(nextNode))
      return;

    let nextData = Templater.getDataForNode(nextNode.nextSibling);
    FilterStorage.moveSubscription(data.subscription, nextData ? nextData.subscription : null);
  },

  /**
   * Opens the context menu for a subscription node.
   */
  openMenu: function(/**Event*/ event, /**Node*/ node)
  {
    node.getElementsByClassName("actionMenu")[0].openPopup(null, "after_pointer", event.clientX, event.clientY, true, false, event);
  },

  _altMask: 2,
  _ctrlMask: 4,
  _metaMask: 8,
  get _accelMask()
  {
    let result = this._ctrlMask;
    try {
      let accelKey = Utils.prefService.getIntPref("ui.key.accelKey");
      if (accelKey == Ci.nsIDOMKeyEvent.DOM_VK_META)
        result = this._metaMask;
      else if (accelKey == Ci.nsIDOMKeyEvent.DOM_VK_ALT)
        result = this._altMask;
    } catch(e) {}
    this.__defineGetter__("_accelMask", function() result);
    return result;
  },

  /**
   * Called when a key is pressed on the subscription list.
   */
  keyPress: function(/**Event*/ event)
  {
    let modifiers = 0;
    if (event.altKey)
      modifiers |= this._altMask;
    if (event.ctrlKey)
      modifiers |= this._ctrlMask;
    if (event.metaKey)
      modifiers |= this._metaMask;

    if (event.charCode == Ci.nsIDOMKeyEvent.DOM_VK_SPACE && modifiers == 0)
    {
      let data = Templater.getDataForNode(this.selectedItem);
      if (data)
        data.subscription.disabled = !data.subscription.disabled;
    }
    else if (event.keyCode == Ci.nsIDOMKeyEvent.DOM_VK_UP && modifiers == this._accelMask)
    {
      E("subscription-moveUp-command").doCommand();
      event.preventDefault();
      event.stopPropagation();
    }
    else if (event.keyCode == Ci.nsIDOMKeyEvent.DOM_VK_DOWN && modifiers == this._accelMask)
    {
      E("subscription-moveDown-command").doCommand();
      event.preventDefault();
      event.stopPropagation();
    }
  },

  /**
   * Subscription currently being dragged if any.
   * @type Subscription
   */
  dragSubscription: null,

  /**
   * Called when a subscription entry is dragged.
   */
  startDrag: function(/**Event*/ event, /**Node*/ node)
  {
    let data = Templater.getDataForNode(node);
    if (!data)
      return;

    event.dataTransfer.setData("text/x-moz-url", data.subscription.url);
    event.dataTransfer.setData("text/plain", data.subscription.title);
    this.dragSubscription = data.subscription;
    event.stopPropagation();
  },

  /**
   * Called when something is dragged over a subscription entry or subscriptions list.
   */
  dragOver: function(/**Event*/ event)
  {
    // Ignore if not dragging a subscription
    if (!this.dragSubscription)
      return;

    // Don't allow dragging onto a scroll bar
    for (let node = event.originalTarget; node; node = node.parentNode)
      if (node.localName == "scrollbar")
        return;

    // Don't allow dragging onto element's borders
    let target = event.originalTarget;
    while (target && target.localName != "richlistitem")
      target = target.parentNode;
    if (!target)
      target = event.originalTarget;

    let styles = window.getComputedStyle(target, null);
    let rect = target.getBoundingClientRect();
    if (event.clientX < rect.left + parseInt(styles.borderLeftWidth, 10) ||
        event.clientY < rect.top + parseInt(styles.borderTopWidth, 10) ||
        event.clientX > rect.right - parseInt(styles.borderRightWidth, 10) - 1 ||
        event.clientY > rect.bottom - parseInt(styles.borderBottomWidth, 10) - 1)
    {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  },

  /**
   * Called when something is dropped on a subscription entry or subscriptions list.
   */
  drop: function(/**Event*/ event, /**Node*/ node)
  {
    if (!this.dragSubscription)
      return;

    // When dragging down we need to insert after the drop node, otherwise before it.
    node = Templater.getDataNode(node);
    if (node)
    {
      let dragNode = Templater.getNodeForData(node.parentNode, "subscription", this.dragSubscription);
      if (node.compareDocumentPosition(dragNode) & node.DOCUMENT_POSITION_PRECEDING)
        node = node.nextSibling;
    }

    let data = Templater.getDataForNode(node);
    FilterStorage.moveSubscription(this.dragSubscription, data ? data.subscription : null);
    event.stopPropagation();
  },

  /**
   * Called when the drag operation for a subscription is finished.
   */
  endDrag: function()
  {
    this.dragSubscription = null;
  }
};

/**
 * Subscription title editing functionality.
 * @class
 */
var TitleEditor =
{
  /**
   * List item corresponding with the currently edited subscription if any.
   * @type Node
   */
  subscriptionEdited: null,

  /**
   * Starts editing of a subscription title.
   * @param {Node} node subscription list entry or a child node
   * @param {Boolean} [checkSelection] if true the editor will not start if the
   *        item was selected in the preceding mousedown event
   */
  start: function(node, checkSelection)
  {
    if (this.subscriptionEdited)
      this.end(true);

    let subscriptionNode = Templater.getDataNode(node);
    if (!subscriptionNode || (checkSelection && !subscriptionNode._wasSelected))
      return;

    subscriptionNode.getElementsByClassName("titleBox")[0].selectedIndex = 1;
    let editor = subscriptionNode.getElementsByClassName("titleEditor")[0];
    editor.value = Templater.getDataForNode(subscriptionNode).subscription.title;
    editor.setSelectionRange(0, editor.value.length);
    this.subscriptionEdited = subscriptionNode;
    editor.focus();
  },

  /**
   * Stops editing of a subscription title.
   * @param {Boolean} save if true the entered value will be saved, otherwise dismissed
   */
  end: function(save)
  {
    if (!this.subscriptionEdited)
      return;

    let subscriptionNode = this.subscriptionEdited;
    this.subscriptionEdited = null;

    let newTitle = null;
    if (save)
    {
      newTitle = subscriptionNode.getElementsByClassName("titleEditor")[0].value;
      newTitle = newTitle.replace(/^\s+/, "").replace(/\s+$/, "");
    }

    let subscription = Templater.getDataForNode(subscriptionNode).subscription
    if (newTitle && newTitle != subscription.title)
      subscription.title = newTitle;
    else
    {
      subscriptionNode.getElementsByClassName("titleBox")[0].selectedIndex = 0;
      subscriptionNode.parentNode.focus();
    }
  },

  /**
   * Processes keypress events on the subscription title editor field.
   */
  keyPress: function(/**Event*/ event)
  {
    // Prevent any key presses from triggering outside actions
    event.stopPropagation();

    if (event.keyCode == event.DOM_VK_RETURN || event.keyCode == event.DOM_VK_ENTER)
    {
      event.preventDefault();
      this.end(true);
    }
    else if (event.keyCode == event.DOM_VK_CANCEL || event.keyCode == event.DOM_VK_ESCAPE)
    {
      event.preventDefault();
      this.end(false);
    }
  }
};

/**
 * Methods called when choosing and adding a new filter subscription.
 * @class
 */
var SelectSubscription =
{
  /**
   * Starts selection of a filter subscription to add.
   */
  start: function(/**Event*/ event)
  {
    let panel = E("selectSubscriptionPanel");
    let list = E("selectSubscription");
    let template = E("selectSubscriptionTemplate");
    let parent = list.menupopup;

    if (panel.state == "open")
    {
      list.focus();
      return;
    }

    // Remove existing entries if any
    while (parent.lastChild)
      parent.removeChild(parent.lastChild);

    // Load data
    let request = new XMLHttpRequest();
    request.open("GET", "subscriptions.xml");
    request.onload = function()
    {
      // Avoid race condition if two downloads are started in parallel
      if (panel.state == "open")
        return;

      // Add subscription entries to the list
      let subscriptions = request.responseXML.getElementsByTagName("subscription");
      let listedSubscriptions = [];
      for (let i = 0; i < subscriptions.length; i++)
      {
        let subscription = subscriptions[i];
        let url = subscription.getAttribute("url");
        if (!url || url in FilterStorage.knownSubscriptions)
          continue;

        let localePrefix = Utils.checkLocalePrefixMatch(subscription.getAttribute("prefixes"));
        let node = Templater.process(template, {
          __proto__: null,
          node: subscription,
          localePrefix: localePrefix
        });
        parent.appendChild(node);
        listedSubscriptions.push(subscription);
      }
      let selectedNode = Utils.chooseFilterSubscription(listedSubscriptions);
      list.selectedItem = Templater.getNodeForData(parent, "node", selectedNode) || parent.firstChild;

      // Show panel and focus list
      let position = (Utils.versionComparator.compare(Utils.platformVersion, "2.0") < 0 ? "after_end" : "bottomcenter topleft");
      panel.openPopup(E("selectSubscriptionButton"), position, 0, 0, false, false, event);
      Utils.runAsync(list.focus, list);
    };
    request.send();
  },

  /**
   * Adds filter subscription that is selected.
   */
  add: function()
  {
    E("selectSubscriptionPanel").hidePopup();

    let data = Templater.getDataForNode(E("selectSubscription").selectedItem);
    if (!data)
      return;

    let subscription = Subscription.fromURL(data.node.getAttribute("url"));
    if (!subscription)
      return;

    FilterStorage.addSubscription(subscription);
    subscription.disabled = false;
    subscription.title = data.node.getAttribute("title");
    subscription.homepage = data.node.getAttribute("homepage");

    // Make sure the subscription is visible and selected
    let list = E("subscriptions");
    let node = Templater.getNodeForData(list, "subscription", subscription);
    if (node)
    {
      list.ensureElementIsVisible(node);
      list.selectedItem = node;
      list.focus();
    }

    // Trigger download if necessary
    if (subscription instanceof DownloadableSubscription && !subscription.lastDownload)
      Synchronizer.execute(subscription);
    FilterStorage.saveToDisk();
  },

  /**
   * Called if the user chooses to view the complete subscriptions list.
   */
  chooseOther: function()
  {
    E("selectSubscriptionPanel").hidePopup();
    window.openDialog("subscriptionSelection.xul", "_blank", "chrome,centerscreen,modal,resizable,dialog=no", null, null);
  },

  /**
   * Called for keys pressed on the subscription selection panel.
   */
  keyPress: function(/**Event*/ event)
  {
    // Buttons and text links handle Enter key themselves
    if (event.target.localName == "button" || event.target.localName == "label")
      return;

    if (event.keyCode == event.DOM_VK_RETURN || event.keyCode == event.DOM_VK_ENTER)
    {
      // This shouldn't accept our dialog, only the panel
      event.preventDefault();
      E("selectSubscriptionAccept").doCommand();
    }
  }
};

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

/**
 * nsITreeView implementation to display filters of a particular filter
 * subscription.
 * @class
 */
var FiltersView =
{
  /**
   * Initialization function.
   */
  init: function()
  {
    if (this.sortProcs)
      return;

    function compareText(/**Filter*/ filter1, /**Filter*/ filter2)
    {
      if (filter1.text < filter2.text)
        return -1;
      else if (filter1.text > filter2.text)
        return 1;
      else
        return 0;
    }
    function compareSlow(/**Filter*/ filter1, /**Filter*/ filter2)
    {
      let isSlow1 = filter1 instanceof RegExpFilter && defaultMatcher.isSlowFilter(filter1);
      let isSlow2 = filter2 instanceof RegExpFilter && defaultMatcher.isSlowFilter(filter2);
      return isSlow1 - isSlow2;
    }
    function compareEnabled(/**Filter*/ filter1, /**Filter*/ filter2)
    {
      let hasEnabled1 = (filter1 instanceof ActiveFilter ? 1 : 0);
      let hasEnabled2 = (filter2 instanceof ActiveFilter ? 1 : 0);
      if (hasEnabled1 != hasEnabled2)
        return hasEnabled1 - hasEnabled2;
      else if (hasEnabled1)
        return (filter2.disabled - filter1.disabled);
      else
        return 0;
    }
    function compareHitCount(/**Filter*/ filter1, /**Filter*/ filter2)
    {
      let hasHitCount1 = (filter1 instanceof ActiveFilter ? 1 : 0);
      let hasHitCount2 = (filter2 instanceof ActiveFilter ? 1 : 0);
      if (hasHitCount1 != hasHitCount2)
        return hasHitCount1 - hasHitCount2;
      else if (hasHitCount1)
        return filter1.hitCount - filter2.hitCount;
      else
        return 0;
    }
    function compareLastHit(/**Filter*/ filter1, /**Filter*/ filter2)
    {
      let hasLastHit1 = (filter1 instanceof ActiveFilter ? 1 : 0);
      let hasLastHit2 = (filter2 instanceof ActiveFilter ? 1 : 0);
      if (hasLastHit1 != hasLastHit2)
        return hasLastHit1 - hasLastHit2;
      else if (hasLastHit1)
        return filter1.lastHit - filter2.lastHit;
      else
        return 0;
    }

    /**
     * Creates a sort function from a primary and a secondary comparison function.
     * @param {Function} cmpFunc  comparison function to be called first
     * @param {Function} fallbackFunc  (optional) comparison function to be called if primary function returns 0
     * @param {Boolean} desc  if true, the result of the primary function (not the secondary function) will be reversed - sorting in descending order
     * @result {Function} comparison function to be used
     */
    function createSortFunction(cmpFunc, fallbackFunc, desc)
    {
      let factor = (desc ? -1 : 1);

      return function(entry1, entry2)
      {
        // Comment replacements not bound to a filter always go last
        let isLast1 = ("origFilter" in entry1 && entry1.filter == null);
        let isLast2 = ("origFilter" in entry2 && entry2.filter == null);
        if (isLast1)
          return (isLast2 ? 0 : 1)
        else if (isLast2)
          return -1;

        let ret = cmpFunc(entry1.filter, entry2.filter);
        if (ret == 0 && fallbackFunc)
          return fallbackFunc(entry1.filter, entry2.filter);
        else
          return factor * ret;
      }
    }

    this.sortProcs = {
      filter: createSortFunction(compareText, null, false),
      filterDesc: createSortFunction(compareText, null, true),
      slow: createSortFunction(compareSlow, compareText, true),
      slowDesc: createSortFunction(compareSlow, compareText, false),
      enabled: createSortFunction(compareEnabled, compareText, false),
      enabledDesc: createSortFunction(compareEnabled, compareText, true),
      hitcount: createSortFunction(compareHitCount, compareText, false),
      hitcountDesc: createSortFunction(compareHitCount, compareText, true),
      lasthit: createSortFunction(compareLastHit, compareText, false),
      lasthitDesc: createSortFunction(compareLastHit, compareText, true)
    };

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
  },

  /**
   * Filter change processing.
   * @see FilterNotifier.addListener()
   */
  _onChange: function(action, item, param1, param2)
  {
    switch (action)
    {
      case "filter.disabled":
      {
        this.updateFilter(item);
        break;
      }
      case "filter.added":
      {
        let subscription = param1;
        let position = param2;
        if (subscription == this._subscription)
          this.addFilterAt(position, item);
        break;
      }
      case "filter.removed":
      {
        let subscription = param1;
        let position = param2;
        if (subscription == this._subscription)
          this.removeFilterAt(position);
        break;
      }
    }
  },

  /**
   * Box object of the tree that this view is attached to.
   * @type nsITreeBoxObject
   */
  boxObject: null,

  /**
   * <tree> element that the view is attached to.
   * @type XULElement
   */
  get treeElement() this.boxObject ? this.boxObject.treeBody.parentNode : null,

  /**
   * Map of used cell properties to the corresponding nsIAtom representations.
   */
  atoms: null,

  /**
   * "Filter" to be displayed if no filter group is selected.
   */
  noGroupDummy: null,

  /**
   * "Filter" to be displayed if the selected group is empty.
   */
  noFiltersDummy: null,

  /**
   * "Filter" to be displayed for a new filter being edited.
   */
  editDummy: null,

  /**
   * Displayed list of filters, might be sorted.
   * @type Filter[]
   */
  data: [],

  /**
   * Tests whether the tree is currently visible.
   */
  get visible()
  {
    return this.boxObject && !this.treeElement.collapsed;
  },

  /**
   * Tests whether the tree is currently focused.
   */
  get focused()
  {
    let focused = document.commandDispatcher.focusedElement;
    while (focused)
    {
      if ("treeBoxObject" in focused && focused.treeBoxObject == this.boxObject)
        return true;
      focused = focused.parentNode;
    }
    return false;
  },

  _subscription: 0,

  /**
   * Filter subscription being displayed.
   * @type Subscription
   */
  get subscription() this._subscription,
  set subscription(value)
  {
    if (value == this._subscription)
      return;

    this._subscription = value;
    if (this.visible)
      this.refresh();
  },

  /**
   * Updates internal view data after a filter subscription change.
   */
  refresh: function()
  {
    let oldCount = this.rowCount;
    this.updateData();

    this.boxObject.rowCountChanged(0, -oldCount);
    this.boxObject.rowCountChanged(0, this.rowCount);
    if (this.rowCount)
      this.selection.select(0);
  },

  /**
   * Map of comparison functions by column ID  or column ID + "Desc" for
   * descending sort order.
   * @const
   */
  sortProcs: null,

  /**
   * Column that the list is currently sorted on.
   * @type Element
   */
  sortColumn: null,

  /**
   * Sorting function currently in use.
   * @type Function
   */
  sortProc: null,

  /**
   * Resorts the list.
   * @param {String} col ID of the column to sort on. If null, the natural order is restored.
   * @param {String} direction "ascending" or "descending", if null the sort order is toggled.
   */
  sortBy: function(col, direction)
  {
    let newSortColumn = null;
    if (col)
    {
      newSortColumn = this.boxObject.columns.getNamedColumn(col).element;
      if (!direction)
      {
        if (this.sortColumn == newSortColumn)
          direction = (newSortColumn.getAttribute("sortDirection") == "ascending" ? "descending" : "ascending");
        else
          direction = "ascending";
      }
    }

    if (this.sortColumn && this.sortColumn != newSortColumn)
      this.sortColumn.removeAttribute("sortDirection");

    this.sortColumn = newSortColumn;
    if (this.sortColumn)
    {
      this.sortColumn.setAttribute("sortDirection", direction);
      this.sortProc = this.sortProcs[col.replace(/^col-/, "") + (direction == "descending" ? "Desc" : "")];
    }
    else
      this.sortProc = null;

    if (this.data.length > 1)
    {
      this.updateData();
      this.boxObject.invalidate();
    }
  },

  /**
   * Changes sort current order for the tree. Sorts by filter column if the list is unsorted.
   * @param {String} order  either "ascending" or "descending"
   */
  setSortOrder: function(sortOrder)
  {
    let col = (this.sortColumn ? this.sortColumn.id : "col-filter");
    this.sortBy(col, sortOrder);
  },

  /**
   * Toggles the visibility of a tree column.
   */
  toggleColumn: function(/**String*/ id)
  {
    let col = E(id);
    col.setAttribute("hidden", col.hidden ? "false" : "true");
  },

  /**
   * Enables or disables all filters in the current selection.
   */
  selectionToggleDisabled: function()
  {
    let filters = [];
    for (let i = 0; i < this.selection.getRangeCount(); i++)
    {
      let min = {};
      let max = {};
      this.selection.getRangeAt(i, min, max);
      for (let j = min.value; j <= max.value; j++)
        if (j >= 0 && j < this.data.length && this.data[j].filter instanceof ActiveFilter)
          filters.push(this.data[j].filter);
    }
    if (filters.length)
    {
      this.boxObject.beginUpdateBatch();
      let newValue = !filters[0].disabled;
      for (let i = 0; i < filters.length; i++)
        filters[i].disabled = newValue;
      this.boxObject.endUpdateBatch();
    }
  },

  /**
   * Selects all entries in the list.
   */
  selectAll: function()
  {
    this.selection.selectAll();
  },

  /**
   * Starts editing the current filter.
   */
  startEditing: function()
  {
    this.treeElement.startEditing(this.selection.currentIndex, this.boxObject.columns.getNamedColumn("col-filter"));
  },

  /**
   * Starts editing a new filter at the current position.
   */
  insertFilter: function()
  {
    if (!(this._subscription instanceof SpecialSubscription))
      return;

    let position = this.selection.currentIndex;
    if (position < 0)
      position = 0;
    if (position >= this.data.length)
      position = this.data.length - 1;

    if (this.data.length == 1 && this.data[0].filter.dummy)
    {
      this.data.splice(0, 1);
      this.boxObject.rowCountChanged(0, -1);
    }

    this.editDummy.index = (position < this.data.length ? this.data[position].index : Math.max(this.data.length - 1, 0));
    this.data.splice(position, 0, this.editDummy);
    this.boxObject.rowCountChanged(position, 1);
    this.selection.currentIndex = position;
    this.boxObject.ensureRowIsVisible(position);
    this.startEditing();

    let origIndex = this.selection.currentIndex;
    let tree = this.treeElement;
    let me = this;
    let listener = function(event)
    {
      if (event.attrName == "editing" && tree.editingRow < 0)
      {
        tree.removeEventListener("DOMAttrModified", listener, false);
        if (me.data[position] == me.editDummy)
        {
          me.data.splice(position, 1);
          me.boxObject.rowCountChanged(position, -1);
          me.selection.currentIndex = origIndex;

          if (me.data.length == 0)
          {
            me.updateData();
            me.boxObject.rowCountChanged(0, me.data.length);
            me.selection.select(0);
          }
        }
      }
    }
    tree.addEventListener("DOMAttrModified", listener, false);
  },

  /**
   * Deletes selected filters.
   */
  deleteSelected: function()
  {
    if (!(this._subscription instanceof SpecialSubscription))
      return;

    let items = [];
    let oldIndex = this.selection.currentIndex;
    for (let i = 0; i < this.selection.getRangeCount(); i++)
    {
      let min = {};
      let max = {};
      this.selection.getRangeAt(i, min, max);
      for (let j = min.value; j <= max.value; j++)
        if (j >= 0 && j < this.data.length)
          items.push(this.data[j]);
    }
    items.sort(function(entry1, entry2) entry2.index - entry1.index);

    if (items.length == 0 || (items.length >= 2 && !Utils.confirm(window, this.treeElement.getAttribute("_removewarning"))))
      return;

    for (let i = 0; i < items.length; i++)
      FilterStorage.removeFilter(items[i].filter, this._subscription, items[i].index);

    if (oldIndex >= this.data.length)
      oldIndex = this.data.length - 1;
    this.selection.select(oldIndex);
    this.boxObject.ensureRowIsVisible(oldIndex);
  },

  /**
   * Updates value of data property on sorting or filter subscription changes.
   */
  updateData: function()
  {
    if (this._subscription && this._subscription.filters.length)
    {
      this.data = this._subscription.filters.map(function(f, i) ({index: i, filter: f}));
      if (this.sortProc)
      {
        // Hide comments in the list, they should be sorted like the filter following them
        let followingFilter = null;
        for (let i = this.data.length - 1; i >= 0; i--)
        {
          if (this.data[i].filter instanceof CommentFilter)
          {
            this.data[i].origFilter = this.data[i].filter;
            this.data[i].filter = followingFilter;
          }
          else
            followingFilter = this.data[i].filter;
        }

        this.data.sort(this.sortProc);

        // Restore comments
        for (let i = 0; i < this.data.length; i++)
        {
          if ("origFilter" in this.data[i])
          {
            this.data[i].filter = this.data[i].origFilter;
            delete this.data[i].origFilter;
          }
        }
      }
    }
    else if (this._subscription)
      this.data = [this.noFiltersDummy]
    else
      this.data = [this.noGroupDummy];
  },

  /**
   * Called to update the view when a filter property is changed.
   */
  updateFilter: function(/**Filter*/ filter)
  {
    for (let i = 0; i < this.data.length; i++)
      if (this.data[i].filter == filter)
        this.boxObject.invalidateRow(i);
  },

  /**
   * Called if a filter has been inserted at the specified position.
   */
  addFilterAt: function(/**Integer*/ position, /**Filter*/ filter)
  {
    if (this.data.length == 1 && this.data[0].filter.dummy)
    {
      this.data.splice(0, 1);
      this.boxObject.rowCountChanged(0, -1);
    }

    if (this.sortProc)
    {
      this.updateData();
      for (let i = 0; i < this.data.length; i++)
      {
        if (this.data[i].index == position)
        {
          position = i;
          break;
        }
      }
    }
    else
    {
      for (let i = 0; i < this.data.length; i++)
        if (this.data[i].index >= position)
          this.data[i].index++;
      this.data.splice(position, 0, {index: position, filter: filter});
    }
    this.boxObject.rowCountChanged(position, 1);
    this.selection.select(position);
    this.boxObject.ensureRowIsVisible(position);
  },

  /**
   * Called if a filter has been removed at the specified position.
   */
  removeFilterAt: function(/**Integer*/ position)
  {
    if (this._subscription.filters.length == 0)
    {
      this.updateData();
      this.boxObject.invalidate();
      this.selection.select(0);
    }
    else
    {
      for (let i = 0; i < this.data.length; i++)
      {
        if (this.data[i].index == position)
        {
          this.data.splice(i, 1);
          this.boxObject.rowCountChanged(i, -1);
          i--;
        }
        else if (this.data[i].index > position)
          this.data[i].index--;
      }
    }
  },

  /**
   * Fills the context menu of the filters columns.
   */
  fillColumnPopup: function()
  {
    E("filters-view-filter").setAttribute("checked", !E("col-filter").hidden);
    E("filters-view-slow").setAttribute("checked", !E("col-slow").hidden);
    E("filters-view-enabled").setAttribute("checked", !E("col-enabled").hidden);
    E("filters-view-hitcount").setAttribute("checked", !E("col-hitcount").hidden);
    E("filters-view-lasthit").setAttribute("checked", !E("col-lasthit").hidden);

    let sortColumn = this.sortColumn;
    let sortColumnID = (sortColumn ? sortColumn.id : null);
    let sortDir = (sortColumn ? sortColumn.getAttribute("sortDirection") : "natural");
    E("filters-sort-none").setAttribute("checked", sortColumn == null);
    E("filters-sort-filter").setAttribute("checked", sortColumnID == "col-filter");
    E("filters-sort-enabled").setAttribute("checked", sortColumnID == "col-enabled");
    E("filters-sort-hitcount").setAttribute("checked", sortColumnID == "col-hitcount");
    E("filters-sort-lasthit").setAttribute("checked", sortColumnID == "col-lasthit");
    E("filters-sort-asc").setAttribute("checked", sortDir == "ascending");
    E("filters-sort-desc").setAttribute("checked", sortDir == "descending");
  },

  /**
   * Called whenever a key is pressed on the list.
   */
  onKeyPress: function(/**Event*/ event)
  {
    if (event.charCode == " ".charCodeAt(0) && !E("col-enabled").hidden)
      this.selectionToggleDisabled();
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsITreeView]),

  setTree: function(boxObject)
  {
    this.init();

    this.boxObject = boxObject;
    if (this.boxObject)
    {
      this.noGroupDummy = {index: 0, filter: {text: this.boxObject.treeBody.getAttribute("noGroupText"), dummy: true}};
      this.noFiltersDummy = {index: 0, filter: {text: this.boxObject.treeBody.getAttribute("noFiltersText"), dummy: true}};
      this.editDummy = {filter: {text: ""}};

      let atomService = Cc["@mozilla.org/atom-service;1"].getService(Ci.nsIAtomService);
      let stringAtoms = ["col-filter", "col-enabled", "col-hitcount", "col-lasthit", "type-comment", "type-filterlist", "type-whitelist", "type-elemhide", "type-invalid"];
      let boolAtoms = ["selected", "dummy", "slow", "disabled"];

      this.atoms = {};
      for each (let atom in stringAtoms)
        this.atoms[atom] = atomService.getAtom(atom);
      for each (let atom in boolAtoms)
      {
        this.atoms[atom + "-true"] = atomService.getAtom(atom + "-true");
        this.atoms[atom + "-false"] = atomService.getAtom(atom + "-false");
      }

      let columns = this.boxObject.columns;
      for (let i = 0; i < columns.length; i++)
        if (columns[i].element.hasAttribute("sortDirection"))
          this.sortBy(columns[i].id, columns[i].element.getAttribute("sortDirection"));
    }
  },

  selection: null,

  get rowCount() this.data.length,

  getCellText: function(row, col)
  {
    if (row < 0 || row >= this.data.length)
      return null;

    col = col.id;
    if (col != "col-filter" && col != "col-slow" && col != "col-hitcount" && col != "col-lasthit")
      return null;

    let filter = this.data[row].filter;
    if (col == "col-filter")
      return filter.text;
    else if (col == "col-slow")
      return (filter instanceof RegExpFilter && defaultMatcher.isSlowFilter(filter) ? "!" : null);
    else if (filter instanceof ActiveFilter)
    {
      if (col == "col-hitcount")
        return filter.hitCount;
      else if (col == "col-lasthit")
        return (filter.lastHit ? Utils.formatTime(filter.lastHit) : null);
    }
    else
      return null;
  },

  getColumnProperties: function(col, properties)
  {
    col = col.id;

    if (col in this.atoms)
      properties.AppendElement(this.atoms[col]);
  },

  getRowProperties: function(row, properties)
  {
    if (row < 0 || row >= this.data.length)
      return;

    let filter = this.data[row].filter;
    properties.AppendElement(this.atoms["selected-" + this.selection.isSelected(row)]);
    properties.AppendElement(this.atoms["slow-" + (filter instanceof RegExpFilter && defaultMatcher.isSlowFilter(filter))]);
    if (filter instanceof ActiveFilter)
      properties.AppendElement(this.atoms["disabled-" + filter.disabled]);
    properties.AppendElement(this.atoms["dummy-" + ("dummy" in filter)]);

    if (filter instanceof CommentFilter)
      properties.AppendElement(this.atoms["type-comment"]);
    else if (filter instanceof BlockingFilter)
      properties.AppendElement(this.atoms["type-filterlist"]);
    else if (filter instanceof WhitelistFilter)
      properties.AppendElement(this.atoms["type-whitelist"]);
    else if (filter instanceof ElemHideFilter)
      properties.AppendElement(this.atoms["type-elemhide"]);
    else if (filter instanceof InvalidFilter)
      properties.AppendElement(this.atoms["type-invalid"]);
  },

  getCellProperties: function(row, col, properties)
  {
    this.getColumnProperties(col, properties);
    this.getRowProperties(row, properties);
  },

  cycleHeader: function(col)
  {
    let oldDirection = col.element.getAttribute("sortDirection");
    if (oldDirection == "ascending")
      this.sortBy(col.id, "descending");
    else if (oldDirection == "descending")
      this.sortBy(null, null);
    else
      this.sortBy(col.id, "ascending");
  },

  isSorted: function()
  {
    return (this.sortProc != null);
  },

  canDrop: function(row, orientation)
  {
    // TODO
    return false;
  },

  drop: function(row, orientation)
  {
    // TODO
  },

  isEditable: function(row, col)
  {
    if (row < 0 || row >= this.data.length)
      return false;
    if (!(this._subscription instanceof SpecialSubscription))
      return false;

    let filter = this.data[row].filter;
    if (col.id == "col-filter")
      return !("dummy" in filter);
    else
      return false;
  },

  setCellText: function(row, col, value)
  {
    if (row < 0 || row >= this.data.length || col.id != "col-filter")
      return;

    let oldFilter = this.data[row].filter;
    let position = this.data[row].index;
    value = Filter.normalize(value);
    if (!value || value == oldFilter.text)
      return;

    let newFilter = Filter.fromText(value);
    if (this.data[row] == this.editDummy)
    {
      this.data.splice(row, 1);
      this.boxObject.rowCountChanged(row, -1);
    }
    else
      FilterStorage.removeFilter(oldFilter, this._subscription, position);
    FilterStorage.addFilter(newFilter, this._subscription, position);
  },

  cycleCell: function(row, col)
  {
    if (row < 0 || row >= this.data.length || col.id != "col-enabled")
      return null;

    let filter = this.data[row].filter;
    if (filter instanceof ActiveFilter)
      filter.disabled = !filter.disabled;
  },

  isContainer: function(row) false,
  isContainerOpen: function(row) false,
  isContainerEmpty: function(row) true,
  getLevel: function(row) 0,
  getParentIndex: function(row) -1,
  hasNextSibling: function(row, afterRow) false,
  toggleOpenState: function(row) {},
  getProgressMode: function() null,
  getImageSrc: function() null,
  isSeparator: function() false,
  performAction: function() {},
  performActionOnRow: function() {},
  performActionOnCell: function() {},
  getCellValue: function() null,
  setCellValue: function() {},
  selectionChanged: function() {},
};
