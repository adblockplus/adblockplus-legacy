/*
 * This file is part of Adblock Plus <http://adblockplus.org/>,
 * Copyright (C) 2006-2013 Eyeo GmbH
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

/**
 * @fileOverview This emulates a subset of the CustomizableUI API from Firefox 28.
 */

let {XPCOMUtils} = Cu.import("resource://gre/modules/XPCOMUtils.jsm", null);

let {Utils} = require("utils");

// UI module has to be referenced lazily to avoid circular references
XPCOMUtils.defineLazyGetter(this, "UI", function() require("ui").UI);

let widgets = Map();

function getToolbox(/**Window*/ window, /**Widget*/ widget) /**Element*/
{
  if (!("defaultArea" in widget) || !widget.defaultArea)
    return null;

  let toolbar = UI.findElement(window, widget.defaultArea);
  if (!toolbar)
    return null;

  let toolbox = toolbar.toolbox;
  if (toolbox && ("palette" in toolbox) && toolbox.palette)
    return toolbox;
  else
    return null;
}

function getToolbar(/**Element*/ element) /**Element*/
{
  for (let parent = element.parentNode; parent; parent = parent.parentNode)
    if (parent.localName == "toolbar")
      return parent;
  return null;
}

function getPaletteItem(/**Element*/ toolbox, /**String*/ id) /**Element*/
{
  for (let child of toolbox.palette.children)
    if (child.id == id)
      return child;

  return null;
}

function restoreWidget(/**Element*/ toolbox, /**Widget*/ widget)
{
  // Create node
  let node = widget.onBuild(toolbox.ownerDocument);

  // Insert into the palette first
  toolbox.palette.insertBefore(node, toolbox.palette.firstChild);

  // Now find out where we should put it
  let position = toolbox.getAttribute(widget.positionAttribute);
  if (!/^\S*,\S*,\S*$/.test(position))
    position = null;

  if (position == null)
  {
    // No explicitly saved position but maybe we can find it in a currentset
    // attribute somewhere.
    let toolbars = toolbox.externalToolbars.slice();
    for (let child of toolbox.children)
      if (child.localName == "toolbar")
        toolbars.push(child);
    for (let toolbar of toolbars)
    {
      let currentSet = toolbar.getAttribute("currentset");
      if (currentSet)
      {
        let items = currentSet.split(",");
        let index = items.indexOf(widget.id);
        if (index >= 0)
        {
          let before = (index + 1 < items.length ? items[index + 1] : "");
          position = "visible," + toolbar.id + "," + before;
          toolbox.setAttribute(widget.positionAttribute, position);
          toolbox.ownerDocument.persist(toolbox.id, widget.positionAttribute);
          break;
        }
      }
    }
  }

  showWidget(toolbox, widget, position);
}

function showWidget(/**Element*/ toolbox, /**Widget*/ widget, /**String*/ position)
{
  let visible = "visible", parent = null, before = null;
  if (position)
  {
    [visible, parent, before] = position.split(",", 3);
    parent = toolbox.ownerDocument.getElementById(parent);
    if (before == "")
      before = null;
    else
      before = toolbox.ownerDocument.getElementById(before);
    if (before && before.parentNode != parent)
      before = null;
  }

  if (visible == "visible" && !parent)
  {
    let insertionPoint = {
      parent: widget.defaultArea
    };
    if (typeof widget.defaultBefore != "undefined")
      insertionPoint.before = widget.defaultBefore;
    if (typeof widget.defaultAfter != "undefined")
      insertionPoint.after = widget.defaultAfter;

    [parent, before] = UI.resolveInsertionPoint(toolbox.ownerDocument.defaultView, insertionPoint);
  }

  if (parent && parent.localName != "toolbar")
    parent = null;

  if (visible != "visible")
  {
    // Move to palette if the item is currently visible
    let node = toolbox.ownerDocument.getElementById(widget.id);
    if (node)
      toolbox.palette.appendChild(node);
  }
  else if (parent)
  {
    // Add the item to the toolbar
    let items = parent.currentSet.split(",");
    let index = (before ? items.indexOf(before.id) : -1);
    if (index < 0)
      before = null;
    parent.insertItem(widget.id, before, null, false);
  }

  saveState(toolbox, widget);
}

function removeWidget(/**Window*/ window, /**Widget*/ widget)
{
  let element = window.document.getElementById(widget.id);
  if (element)
    element.parentNode.removeChild(element);

  let toolbox = getToolbox(window, widget);
  if (toolbox)
  {
    let paletteItem = getPaletteItem(toolbox, widget.id);
    if (paletteItem)
      paletteItem.parentNode.removeChild(paletteItem);
  }
}

function onToolbarCustomization(/**Event*/ event)
{
  let toolbox = event.currentTarget;
  for (let [id, widget] of widgets)
    saveState(toolbox, widget);
}

function saveState(/**Element*/ toolbox, /**Widget*/ widget)
{
  let node = toolbox.ownerDocument.getElementById(widget.id);

  let position = toolbox.getAttribute(widget.positionAttribute) || "hidden,,";
  if (node)
  {
    if (typeof widget.onAdded == "function")
      widget.onAdded(node)

    let toolbar = getToolbar(node);
    position = "visible," + toolbar.id + "," + (node.nextSibling ? node.nextSibling.id : "");
  }
  else
    position = position.replace(/^visible,/, "hidden,")

  toolbox.setAttribute(widget.positionAttribute, position);
  toolbox.ownerDocument.persist(toolbox.id, widget.positionAttribute);
}

let CustomizableUI = exports.CustomizableUI =
{
  createWidget: function(widget)
  {
    if (typeof widget.id == "undefined" ||
        typeof widget.defaultArea == "undefined" ||
        typeof widget.positionAttribute == "undefined")
    {
      throw new Error("Unexpected: required property missing from the widget data");
    }
    widgets.set(widget.id, widget);

    // Show widget in any existing windows
    for (let window of UI.applicationWindows)
    {
      let toolbox = getToolbox(window, widget);
      if (toolbox)
      {
        toolbox.addEventListener("aftercustomization", onToolbarCustomization, false);
        restoreWidget(toolbox, widget);
      }
    }
  },

  destroyWidget: function(id)
  {
    // Don't do anything here. This function is called on shutdown,
    // removeFromWindow will take care of cleaning up already.
  },

  getPlacementOfWidget: function(id)
  {
    let window = UI.currentWindow;
    if (!window)
      return null;

    let widget = window.document.getElementById(id);
    if (!widget)
      return null;

    let toolbar = getToolbar(widget);
    if (!toolbar)
      return null;

    return {area: toolbar.id};
  },

  addWidgetToArea: function(id)
  {
    // Note: the official API function also has area and position parameters.
    // We ignore those here and simply restore the previous position instead.
    let widget = widgets.get(id);
    for (let window of UI.applicationWindows)
    {
      let toolbox = getToolbox(window, widget);
      if (!toolbox)
        continue;

      let position = toolbox.getAttribute(widget.positionAttribute);
      if (position)
        position = position.replace(/^hidden,/, "visible,");
      showWidget(toolbox, widget, position);
    }
  },

  removeWidgetFromArea: function(id)
  {
    let widget = widgets.get(id);
    for (let window of UI.applicationWindows)
    {
      let toolbox = getToolbox(window, widget);
      if (!toolbox)
        continue;

      let position = toolbox.getAttribute(widget.positionAttribute);
      if (position)
        position = position.replace(/^visible,/, "hidden,");
      else
        position = "hidden,,";
      showWidget(toolbox, widget, position);
    }
  }
};

let {WindowObserver} = require("windowObserver");
new WindowObserver({
  applyToWindow: function(window)
  {
    let {isKnownWindow} = require("appSupport");
    if (!isKnownWindow(window))
      return;

    for (let [id, widget] of widgets)
    {
      let toolbox = getToolbox(window, widget);
      if (toolbox)
      {
        toolbox.addEventListener("aftercustomization", onToolbarCustomization, false);

        // Restore widget asynchronously to allow the stylesheet to load
        Utils.runAsync(restoreWidget.bind(null, toolbox, widget));
      }
    }
  },

  removeFromWindow: function(window)
  {
    let {isKnownWindow} = require("appSupport");
    if (!isKnownWindow(window))
      return;

    for (let [id, widget] of widgets)
    {
      let toolbox = getToolbox(window, widget);
      if (toolbox)
        toolbox.removeEventListener("aftercustomization", onToolbarCustomization, false);

      removeWidget(window, widget);
    }
  }
});
