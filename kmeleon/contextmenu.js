var gContextMenu = {
  abpItems: {
    "abp-image-menuitem" : 0,
    "abp-object-menuitem" : 1,
    "abp-frame-menuitem" : 2
  },
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
  updateMenu: function(target) {
    resetContextMenu();
    this.target = target;
    document.popupNode = this.target;
    for (var i = 0; i < this.showListeners.length; i++)
      this.showListeners[i].call(this);
  },
  appendChild: function() {}
}