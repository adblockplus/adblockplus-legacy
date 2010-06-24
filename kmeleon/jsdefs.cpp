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
 * Portions created by the Initial Developer are Copyright (C) 2006-2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

#include "adblockplus.h"
JSFunctionSpec module_functions[] = {
  {"alert", JSAlert, 1, JSPROP_ENUMERATE|JSPROP_READONLY|JSPROP_PERMANENT, 0},
  {"setIcon", JSSetIcon, 1, JSPROP_ENUMERATE|JSPROP_READONLY|JSPROP_PERMANENT, 0},
  {"hideStatusBar", JSHideStatusBar, 1, JSPROP_ENUMERATE|JSPROP_READONLY|JSPROP_PERMANENT, 0},
  {"openTab", JSOpenTab, 2, JSPROP_ENUMERATE|JSPROP_READONLY|JSPROP_PERMANENT, 0},
  {"resetContextMenu", JSResetContextMenu, 0, JSPROP_ENUMERATE|JSPROP_READONLY|JSPROP_PERMANENT, 0},
  {"addContextMenuItem", JSAddContextMenuItem, 1, JSPROP_ENUMERATE|JSPROP_READONLY|JSPROP_PERMANENT, 0},
  {"createCommandID", JSCreateCommandID, 0, JSPROP_ENUMERATE|JSPROP_READONLY|JSPROP_PERMANENT, 0},
  {"createPopupMenu", JSCreatePopupMenu, 0, JSPROP_ENUMERATE|JSPROP_READONLY|JSPROP_PERMANENT, 0},
  {"addMenuItem", JSAddMenuItem, 7, JSPROP_ENUMERATE|JSPROP_READONLY|JSPROP_PERMANENT, 0},
  {"getHWND", JSGetHWND, 1, JSPROP_ENUMERATE|JSPROP_READONLY|JSPROP_PERMANENT, 0},
  {"subclassDialogWindow", JSSubclassDialogWindow, 1, JSPROP_ENUMERATE|JSPROP_READONLY|JSPROP_PERMANENT, 0},
  {"addRootListener", JSAddRootListener, 3, JSPROP_ENUMERATE|JSPROP_READONLY|JSPROP_PERMANENT, 0},
  {"removeRootListener", JSRemoveRootListener, 3, JSPROP_ENUMERATE|JSPROP_READONLY|JSPROP_PERMANENT, 0},
  {"focusWindow", JSFocusWindow, 1, JSPROP_ENUMERATE|JSPROP_READONLY|JSPROP_PERMANENT, 0},
  {"setTopmostWindow", JSSetTopmostWindow, 1, JSPROP_ENUMERATE|JSPROP_READONLY|JSPROP_PERMANENT, 0},
  {"showToolbarContext", JSShowToolbarContext, 1, JSPROP_ENUMERATE|JSPROP_READONLY|JSPROP_PERMANENT, 0},
  {nsnull, nsnull, 0, 0, 0},
};

WORD context_commands[] = {
  CMD_IMAGE,
  CMD_OBJECT,
  CMD_FRAME
};

/************************
 * JavaScript callbacks *
 ************************/
 
JSBool JSAlert(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;

  JSString* message;
  if (!JS_ConvertArguments(cx, argc, argv, "S", &message))
    return JS_FALSE;

  MessageBoxW(NULL, (LPWSTR)JS_GetStringChars(message), L"JavaScript message", 0);
  return JS_TRUE;
}

JSBool JSSetIcon(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;

  if (argc == 1)
  {
    int32 icon = JSVAL_TO_INT(argv[0]);
    toolbarList.setToolbarIcon(icon);
    statusbarList.setStatusIcon(icon);
  }

  return JS_TRUE;
}

JSBool JSHideStatusBar(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;

  if (argc == 1)
    statusbarList.setHidden(JSVAL_TO_BOOLEAN(argv[0]));

  return JS_TRUE;
}

JSBool JSOpenTab(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;

  char* url;
  int32 wnd;
  if (!JS_ConvertArguments(cx, argc, argv, "sj", &url, &wnd))
    return JS_FALSE;

  OpenTab(url, (HWND)wnd);
  return JS_TRUE;
}

TCHAR* menus[] = {_T("DocumentPopup"), _T("DocumentImagePopup"), _T("TextPopup"),
                  _T("LinkPopup"), _T("ImageLinkPopup"), _T("ImagePopup"),
                  _T("FrameDocumentPopup"), _T("FrameDocumentImagePopup"), _T("FrameTextPopup"),
                  _T("FrameLinkPopup"), _T("FrameImageLinkPopup"), _T("FrameImagePopup"),
                  NULL};

JSBool JSResetContextMenu(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;

  for (int i = 0; menus[i]; i++) {
    HMENU hMenu = kFuncs->GetMenu(menus[i]);
    if (hMenu) {
      int count = GetMenuItemCount(hMenu);
      for (int j = 0; j < count; j++) {
        WORD id = GetMenuItemID(hMenu, j) - cmdBase;
        if (id < NUM_COMMANDS)
          RemoveMenu(hMenu, j--, MF_BYPOSITION);
      }
    }
  }

  return JS_TRUE;
}

JSBool JSAddContextMenuItem(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;

  int32 item;
  if (!JS_ConvertArguments(cx, argc, argv, "j", &item))
    return JS_FALSE;

  if (item < 0 || item >= NUM_LABELS)
    return JS_TRUE;

  MENUITEMINFO info = {0};
  info.cbSize = sizeof info;
  info.fMask = MIIM_TYPE;

  UINT drawFlag;
  for (int i = 0; menus[i]; i++) {
    HMENU hMenu = kFuncs->GetMenu(menus[i]);
    if (hMenu) {
      drawFlag = MF_OWNERDRAW;

      int count = GetMenuItemCount(hMenu);
      if (count > 0) {
        WORD id = GetMenuItemID(hMenu, count - 1) - cmdBase;
        if (id >= NUM_COMMANDS)
          AppendMenuA(hMenu, MF_SEPARATOR, cmdBase + CMD_SEPARATOR, NULL);

        // Only use MF_OWNERDRAW flag if other menu items have it as well
        if (GetMenuItemInfo(hMenu, 0, TRUE, &info) && !(info.fType & MFT_OWNERDRAW))
          drawFlag = MF_STRING;
      }
      AppendMenuA(hMenu, drawFlag, cmdBase + context_commands[item], labelValues[item]);
    }
  }
  return JS_TRUE;
}

JSBool JSCreateCommandID(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = INT_TO_JSVAL(kFuncs->GetCommandIDs(1));

  return JS_TRUE;
}

JSBool JSCreatePopupMenu(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  HMENU ret = CreatePopupMenu();
  *rval = INT_TO_JSVAL(ret);

  return JS_TRUE;
}

JSBool JSAddMenuItem(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;

  int32 menu;
  int32 type;
  int32 menuID;
  char* label;
  JSBool default;
  JSBool disabled;
  JSBool checked;
  if (!JS_ConvertArguments(cx, argc, argv, "jjjsbbb", &menu, &type, &menuID, &label, &default, &disabled, &checked))
    return JS_FALSE;
  HMENU hMenu = (HMENU)menu;

  MENUITEMINFO info = {0};
  info.cbSize = sizeof info;
  info.fMask = MIIM_STATE | MIIM_SUBMENU | MIIM_TYPE;
  if (menuID >= 0 && !disabled)
    info.fMask |= MIIM_ID;
  info.fType = (type < 0 ? MFT_SEPARATOR : MFT_STRING);
  info.fState = (disabled ? MFS_GRAYED : MFS_ENABLED);
  if (checked)
    info.fState |= MFS_CHECKED;
  if (default)
    info.fState |= MFS_DEFAULT;
  info.wID = (UINT)menuID;
  info.hSubMenu = type > 0 ? (HMENU)type : NULL;
  info.dwTypeData = label;

  InsertMenuItem(hMenu, -1, TRUE, &info);

  return JS_TRUE;
}

JSBool JSGetHWND(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_NULL;

  if (argc != 1) {
    JS_ReportError(cx, "getHWND: wrong number of arguments");
    return JS_FALSE;
  }

  nsCOMPtr<nsIEmbeddingSiteWindow> wnd  = do_QueryInterface(UnwrapNative(cx, JSVAL_TO_OBJECT(argv[0])));
  if (wnd == nsnull)
    return JS_TRUE;

  void* hWnd;
  nsresult rv = wnd->GetSiteWindow(&hWnd);
  if (NS_FAILED(rv))
    return JS_TRUE;

  *rval = INT_TO_JSVAL((int32)hWnd);
  return JS_TRUE;
}

JSBool JSSubclassDialogWindow(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;

  int32 wnd;
  if (!JS_ConvertArguments(cx, argc, argv, "j", &wnd))
    return JS_FALSE;
  
  origDialogWndProc = SubclassWindow((HWND)wnd, &DialogWndProc);

  return JS_TRUE;
}

JSBool JSAddRootListener(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;

  JSObject* wndObject;
  char* event;
  JSBool capture;
  if (!JS_ConvertArguments(cx, argc, argv, "osb", &wndObject, &event, &capture))
    return JS_FALSE;

  nsCOMPtr<nsPIDOMWindow> privateWnd = do_QueryInterface(UnwrapNative(cx, wndObject));
  if (privateWnd == nsnull)
    return JS_TRUE;

  nsCOMPtr<nsPIDOMWindow> rootWnd = privateWnd->GetPrivateRoot();
  if (rootWnd == nsnull)
    return NS_ERROR_FAILURE;

  nsCOMPtr<nsPIDOMEventTarget> privateTarget = rootWnd->GetChromeEventHandler();
  if (privateTarget == nsnull)
    return NS_ERROR_FAILURE;

  nsCOMPtr<nsIDOMEventTarget> target = do_QueryInterface(privateTarget);
  if (target == nsnull)
    return NS_ERROR_FAILURE;

  target->AddEventListener(NS_ConvertASCIItoUTF16(event), listener, capture);
  return JS_TRUE;
}

JSBool JSRemoveRootListener(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;

  JSObject* wndObject;
  char* event;
  JSBool capture;
  if (!JS_ConvertArguments(cx, argc, argv, "osb", &wndObject, &event, &capture))
    return JS_FALSE;

  nsCOMPtr<nsPIDOMWindow> privateWnd = do_QueryInterface(UnwrapNative(cx, wndObject));
  if (privateWnd == nsnull)
    return JS_TRUE;

  nsCOMPtr<nsPIDOMWindow> rootWnd = privateWnd->GetPrivateRoot();
  if (rootWnd == nsnull)
    return NS_ERROR_FAILURE;

  nsCOMPtr<nsPIDOMEventTarget> privateTarget = rootWnd->GetChromeEventHandler();
  if (privateTarget == nsnull)
    return NS_ERROR_FAILURE;

  nsCOMPtr<nsIDOMEventTarget> target = do_QueryInterface(privateTarget);
  if (target == nsnull)
    return NS_ERROR_FAILURE;

  target->RemoveEventListener(NS_ConvertASCIItoUTF16(event), listener, capture);
  return JS_TRUE;
}

JSBool JSFocusWindow(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;

  int32 wnd;
  if (!JS_ConvertArguments(cx, argc, argv, "j", &wnd))
    return JS_FALSE;

  BringWindowToTop((HWND)wnd);
  return JS_TRUE;
}

JSBool JSSetTopmostWindow(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;

  int32 wnd;
  if (!JS_ConvertArguments(cx, argc, argv, "j", &wnd))
    return JS_FALSE;

  SetWindowPos((HWND)wnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOMOVE | SWP_NOSIZE);
  return JS_TRUE;
}

JSBool JSShowToolbarContext(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;

  int32 wnd;
  if (!JS_ConvertArguments(cx, argc, argv, "j", &wnd))
    return JS_FALSE;

  ShowContextMenu((HWND)wnd, PR_FALSE);

  return JS_TRUE;
}
