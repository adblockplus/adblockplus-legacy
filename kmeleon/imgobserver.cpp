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
 
nsCOMPtr<abpImgObserver> imgObserver = new abpImgObserver();

NS_IMPL_ISUPPORTS2(abpImgObserver, imgIDecoderObserver, imgIContainerObserver)

/**************************************
 * imgIDecoderObserver implementation *
 **************************************/

nsresult abpImgObserver::OnStopFrame(imgIRequest* aRequest, gfxIImageFrame *aFrame) {
  nsresult rv;

  gfx_format format;
  rv = aFrame->GetFormat(&format);
  if (NS_FAILED(rv))
    return rv;

  if (format != gfxIFormats::BGR_A8)
    return NS_ERROR_UNEXPECTED;

  PRInt32 width;
  rv = aFrame->GetWidth(&width);
  if (NS_FAILED(rv))
    return rv;

  PRInt32 height;
  rv = aFrame->GetHeight(&height);
  if (NS_FAILED(rv))
    return rv;

  PRUint8* imageBits;
  PRUint32 imageSize;
  rv = aFrame->GetImageData(&imageBits, &imageSize);
  if (NS_FAILED(rv))
    return rv;

  PRUint8* alphaBits;
  PRUint32 alphaSize;
  rv = aFrame->GetAlphaData(&alphaBits, &alphaSize);
  if (NS_FAILED(rv))
    return rv;

  HDC hDC = ::GetDC(NULL);

  PRUint8* bits = new PRUint8[imageSize + alphaSize];

  for (PRUint32 i = 0, j = 0, n = 0; i < imageSize && j < alphaSize && n < imageSize + alphaSize;) {
    bits[n++] = imageBits[i++];
    bits[n++] = imageBits[i++];
    bits[n++] = imageBits[i++];
    bits[n++] = alphaBits[j++];
  }

  BITMAPINFOHEADER head;
  head.biSize = sizeof(head);
  head.biWidth = width;
  head.biHeight = height;
  head.biPlanes = 1;
  head.biBitCount = 32;
  head.biCompression = BI_RGB;
  head.biSizeImage = imageSize + alphaSize;
  head.biXPelsPerMeter = 0;
  head.biYPelsPerMeter = 0;
  head.biClrUsed = 0;
  head.biClrImportant = 0;

  HBITMAP image = ::CreateDIBitmap(hDC, NS_REINTERPRET_CAST(CONST BITMAPINFOHEADER*, &head),
                                   CBM_INIT, bits, NS_REINTERPRET_CAST(CONST BITMAPINFO*, &head),
                                   DIB_RGB_COLORS);
  delete bits;

  ImageList_Add(hImages, image, NULL);
  DeleteObject(image);

  ReleaseDC(NULL, hDC);

  return NS_OK;
}

nsresult abpImgObserver::OnStartDecode(imgIRequest* aRequest) {
  return NS_OK;
}
nsresult abpImgObserver::OnStartContainer(imgIRequest* aRequest, imgIContainer *aContainer) {
  return NS_OK;
}
nsresult abpImgObserver::OnStartFrame(imgIRequest* aRequest, gfxIImageFrame *aFrame) {
  return NS_OK;
}
nsresult abpImgObserver::OnDataAvailable(imgIRequest *aRequest, gfxIImageFrame *aFrame, const nsIntRect * aRect) {
  return NS_OK;
}
nsresult abpImgObserver::OnStopContainer(imgIRequest* aRequest, imgIContainer *aContainer) {
  return NS_OK;
}
nsresult abpImgObserver::OnStopDecode(imgIRequest* aRequest, nsresult status, const PRUnichar *statusArg) {
  LoadImage(currentImage + 1);
  return NS_OK;
}
nsresult abpImgObserver::FrameChanged(imgIContainer *aContainer, gfxIImageFrame *aFrame, nsIntRect * aDirtyRect) {
  return NS_OK;
}
