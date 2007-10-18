var gContextMenu = {
  target: null,
  showListeners: [],
  addEventListener: function(event, handler, capture) {
    if (event == "popupshowing")
      this.showListeners.push(handler);
  },
  removeEventListener: function(event, handler, capture) {
    if (event == "popupshowing")
      this.showListeners = this.showListeners.filter(function(item) {return item != handler});
  },
  showItem: function(item, show) {
    if (!show)
      return;

    if (item == "abp-image-menuitem")
      addContextMenuItem(0);
    else if (item == "abp-object-menuitem")
      addContextMenuItem(1);
    else if (item == "abp-link-menuitem")
      addContextMenuItem(2);
    else if (item == "abp-frame-menuitem")
      addContextMenuItem(3);
  },
  updateMenu: function(target) {
    resetContextMenu();
    this.target = target;
    for (var i = 0; i < this.showListeners.length; i++)
      this.showListeners[i].call(this);
  },
  appendChild: function() {}
}