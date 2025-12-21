import { type CameraSceneApi } from "../CameraScene";
import { initExcelLikeWebixSheet } from "./SpeardSheetUI";

export type LayoutModelHandle = {
    container: HTMLElement;
};

// Re-use specific icons or add new ones. 
// For LayoutModel, I'll use placeholders or generic icons available in the folder.
type LayoutButton = {
    id: string;
    label: string;
    icon: string;
};

const layoutButtons: LayoutButton[] = [
    { id: "view-2d", label: "2D View", icon: "View2D" },
    { id: "view-3d", label: "3D View", icon: "View3D" },
    { id: "export-excel", label: "Export Excel", icon: "FileXls" },
];

const iconCache = new Map<string, string>();

async function fetchIcon(name: string): Promise<string> {
    if (iconCache.has(name)) return iconCache.get(name)!;
    try {
        const response = await fetch(`/assets/icon/${name}.svg`);
        const text = await response.text();
        iconCache.set(name, text);
        return text;
    } catch (e) {
        console.warn(`Icon ${name} not found`);
        return "";
    }
}

function createButton(btnDef: LayoutButton, iconHtml: string) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "layout-model-button"; // Different class from dock-button
    btn.innerHTML = iconHtml;
    btn.setAttribute("aria-label", btnDef.label);
    btn.dataset.layoutId = btnDef.id;

    // The click listener is now handled in setupLayoutModel for specific logic
    // btn.addEventListener("click", () => {
    //     // Toggle active state locally for visual feedback
    //     btn.classList.toggle("active");
    //     console.log(`LayoutModel: Clicked ${btnDef.id}`);
    // });

    return btn;
}

export async function setupLayoutModel(cameraScene: CameraSceneApi) {
    // Create wrapper
    const wrapper = document.createElement("div");
    wrapper.id = "layout-model-wrapper";

    // Create toolbar container
    const toolbar = document.createElement("div");
    toolbar.id = "layout-model-toolbar";
    toolbar.role = "toolbar";

    // Generate buttons
    const buttons = await Promise.all(
        layoutButtons.map(async (b) => {
            const icon = await fetchIcon(b.icon);
            return createButton(b, icon);
        })
    );

    buttons.forEach(btn => {
        toolbar.appendChild(btn);

        // Logic for specific buttons
        btn.addEventListener("click", async () => {
            const id = btn.dataset.layoutId;

            // Update active state
            buttons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            if (id === "view-2d") {
                // 2D Logic: Orthographic Top View
                await cameraScene.setProjection("Orthographic");
                // Set to top view: Position high Y, Target 0,0,0
                // ThatOpen camera controls SetLookAt(px, py, pz, tx, ty, tz, transition)
                await cameraScene.camera.controls.setLookAt(0, 100, 0, 0, 0, 0, true);

                // Lock rotation for true 2D feel? Optional. 
                // For now just set view.
                // cameraScene.camera.controls.minPolarAngle = 0;
                // cameraScene.camera.controls.maxPolarAngle = 0; 
            } else if (id === "view-3d") {
                // 3D Logic: Perspective Isometric View
                await cameraScene.setProjection("Perspective");
                // Set to isometric-ish view
                await cameraScene.camera.controls.setLookAt(50, 50, 50, 0, 0, 0, true);

                // Unlock rotation if locked
                // cameraScene.camera.controls.minPolarAngle = 0;
                // cameraScene.camera.controls.maxPolarAngle = Math.PI;
            } else if (id === "export-excel") {
                const excelContainerId = "webix-excel-container";
                let excelContainer = document.getElementById(excelContainerId);

                if (!excelContainer) {
                    // Create container if first time
                    excelContainer = document.createElement("div");
                    excelContainer.id = excelContainerId;
                    excelContainer.style.position = "fixed";
                    excelContainer.style.top = "0";
                    excelContainer.style.left = "0";
                    excelContainer.style.width = "100vw";
                    excelContainer.style.height = "100vh";
                    excelContainer.style.zIndex = "2000"; // Above everything
                    excelContainer.style.background = "white"; // Webix usually needs a background
                    excelContainer.style.display = "none";
                    document.body.appendChild(excelContainer);

                    // Initialize Webix Sheet
                    // Note: using a timeout to allow display:block to potentially settle if needed, 
                    // but initExcelLikeWebixSheet handles its own mounting.
                    await initExcelLikeWebixSheet({
                        mount: excelContainer,
                        title: "Project Data",
                        webixCdnJs: "https://cdn.webix.com/edge/webix.js",
                        webixCssLight: "https://cdn.webix.com/edge/webix.css",
                        webixCssDark: "https://cdn.webix.com/edge/skins/dark.css"
                    });

                    // Add a close button logic internal to the sheet? 
                    // The generic sheet UI has an "X" icon class .xl-appicon but we might need to hook up a real close event.
                    // For now, let's just assume we can toggle via the button again.
                    // Or we can add a close handler if the UI supports it.
                    // Looking at SpeardSheetUI.ts, .xl-appicon is just static HTML. 
                    // We might need to add a specialized close button listener or relies on the user clicking the specific logic.
                    // Let's add a close listener to the container's close button if possible, after init.
                    setTimeout(() => {
                        // Try to find a close button or 'X' in the UI we just rendered
                        // The UI has <div class="xl-appicon">X</div>. We can making it clickable.
                        const appIcon = excelContainer!.querySelector(".xl-appicon") as HTMLElement;
                        if (appIcon) {
                            appIcon.style.cursor = "pointer";
                            appIcon.addEventListener("click", () => {
                                excelContainer!.style.display = "none";
                                btn.classList.remove("active");
                            });
                        }
                    }, 1000);
                }

                // Toggle Visibility
                if (excelContainer.style.display === "none") {
                    excelContainer.style.display = "block";
                    btn.classList.add("active");
                } else {
                    excelContainer.style.display = "none";
                    btn.classList.remove("active");
                }
            }
        });

    });
    wrapper.appendChild(toolbar);

    document.body.appendChild(wrapper);

    return {
        container: wrapper
    };
}
