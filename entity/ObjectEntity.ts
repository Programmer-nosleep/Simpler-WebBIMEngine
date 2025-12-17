import * as THREE from 'three';
import { BaseEntity } from './BaseEntity';

export type ObjectScene = THREE.Object3D & {
  userData: {
    entityId?: string;
    entityType?: string;
    label?: string;
    selectable?: boolean;
    locked?: boolean;
    QreaseeCategory?: string;
    IFCClass?: string;
    [key: string]: any;
  };
};

export function toObjectScene(entity: BaseEntity): ObjectScene {
  return entity.mesh as ObjectScene;
}
