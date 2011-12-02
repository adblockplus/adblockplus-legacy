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
  if (window.arguments && window.arguments.length)
  {
    let filter = window.arguments[0].wrappedJSObject;
    if (filter instanceof Filter)
      Utils.runAsync(SubscriptionActions.selectFilter, SubscriptionActions, filter);
  }
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
  if (FilterActions.visible)
    FilterView.refresh();
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
  FilterView.subscription = (data ? data.subscription : null);
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
