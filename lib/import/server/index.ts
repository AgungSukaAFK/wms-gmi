import type { ImportHandler } from "./common";
import { barangHandler } from "./barang";
import { vendorHandler } from "./vendor";
import { customerHandler } from "./customer";
import { hmUnitHandler } from "./hm-unit";
import { spbPipelineHandler } from "./spb-pipeline";
import { spbPaymentHandler } from "./spb-payment";
import { receiveHandler } from "./receive";
import { soRegulerHandler } from "./so-reguler";
import { doRegulerHandler } from "./do-reguler";
import { consignmentIkHandler, consignmentSoHandler } from "./consignment";
import { spbHandler } from "./spb";
import { mrHandler, poHandler, prHandler } from "./procurement";
import { deliveryHandler, itemTransferHandler } from "./transfer";

export const IMPORT_HANDLERS: Record<string, ImportHandler> = {
  barang: barangHandler,
  vendor: vendorHandler,
  customer: customerHandler,
  hm_unit: hmUnitHandler,
  spb_pipeline: spbPipelineHandler,
  spb_payment: spbPaymentHandler,
  receive: receiveHandler,
  so_reguler: soRegulerHandler,
  do_reguler: doRegulerHandler,
  consignment_so: consignmentSoHandler,
  consignment_ik: consignmentIkHandler,
  spb: spbHandler,
  mr: mrHandler,
  pr: prHandler,
  po: poHandler,
  item_transfer: itemTransferHandler,
  delivery: deliveryHandler,
};
