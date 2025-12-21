import * as THREE from "three";

export class GroupManager {
    private scene: THREE.Scene;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
    }

    createGroupFromObjects(objects: THREE.Object3D[]) {
        if (objects.length === 0) return null;

        // Filter out objects that are already in a group or shouldn't be grouped (like helpers)
        const validObjects = objects.filter((obj) => {
            // Prevent grouping the scene itself or helpers
            if ((obj as any).isScene || (obj as any).isCamera) return false;
            if (obj.userData.isHelper) return false;
            // Also maybe prevent grouping if it's already a child of another user-group?
            // For now, allow nested grouping (group inside group).
            return true;
        });

        if (validObjects.length === 0) return null;

        const group = new THREE.Group();
        group.name = `Group_${Date.now()}`;
        group.userData.selectable = true; // The group itself should be selectable
        group.userData.isGroup = true;

        // Add group to scene first
        this.scene.add(group);

        // Reparent objects to the group
        validObjects.forEach((obj) => {
            group.attach(obj);
        });

        // Create visual helper (Cube UI)
        // User wanted "visual ... beruka kubus". 
        // We use BoxHelper to show the bounds.
        const boxHelper = new THREE.BoxHelper(group, 0x00ff00); // Green box for group
        boxHelper.userData.isHelper = true;
        boxHelper.userData.isGroupHelper = true; // Tag it
        this.scene.add(boxHelper);

        // Store reference to helper in group userData so we can update/remove it
        group.userData.helperId = boxHelper.uuid;

        return group;
    }

    updateHelpers() {
        this.scene.traverse((obj) => {
            if (obj.userData.isGroupHelper && obj instanceof THREE.BoxHelper) {
                obj.update();
            }
        });
    }
}
