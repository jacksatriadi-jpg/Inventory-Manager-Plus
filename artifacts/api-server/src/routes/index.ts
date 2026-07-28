import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import materialsRouter from "./materials";
import scanInRouter from "./scanIn";
import scanOutRouter from "./scanOut";
import historyRouter from "./history";
import dashboardRouter from "./dashboard";
import backupRouter from "./backup";
import materialMasukRouter from "./materialMasuk";
import materialKeluarRouter from "./materialKeluar";
import sheetsRouter from "./sheets";
import materialBekasRouter from "./materialBekas";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(materialsRouter);
router.use(scanInRouter);
router.use(scanOutRouter);
router.use(historyRouter);
router.use(dashboardRouter);
router.use(backupRouter);
router.use(materialMasukRouter);
router.use(materialKeluarRouter);
router.use(sheetsRouter);
router.use(materialBekasRouter);

export default router;
