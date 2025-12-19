import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

/**
 * DwgLoader
 * 
 * A loader for importing 2D CAD drawings into Three.js.
 * 
 * IMPORTANT:
 * Native .dwg files are proprietary binary files and cannot be parsed directly 
 * in the browser without heavy libraries or backend conversion.
 * 
 * This implementation parses the DXF (ASCII) format, which is the standard 
 * open exchange format for CAD. Please save/export your .dwg files as .dxf 
 * (ASCII) to use this loader.
 */
export class DwgLoader {
  private loader: THREE.FileLoader;
  private defaultColor: number;
  private defaultLineWidth: number;
  public resolution: THREE.Vector2;

  constructor(manager?: THREE.LoadingManager) {
    this.loader = new THREE.FileLoader(manager);
    this.loader.setResponseType("text");
    this.defaultColor = 0xffffff;
    this.defaultLineWidth = 2;
    this.resolution = new THREE.Vector2(1920, 1080);
  }

  load(
    url: string,
    onLoad: (group: THREE.Group) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (err: unknown) => void
  ) {
    this.loader.load(
      url,
      (text) => {
        if (typeof text === "string") {
          try {
            const group = this.parse(text);
            onLoad(group);
          } catch (e) {
            if (onError) onError(e);
            else console.error(e);
          }
        } else {
          const err = new Error("DwgLoader: Expected text content (DXF format).");
          if (onError) onError(err);
          else console.error(err);
        }
      },
      onProgress,
      onError
    );
  }

  parse(text: string): THREE.Group {
    const group = new THREE.Group();
    // Optional: Rotate to lie flat on XZ plane if needed
    // group.rotation.x = -Math.PI / 2;

    const lines = text.split(/\r\n|\r|\n/);
    let code = -1;
    let value = "";
    let currentSection = "";
    let entityType = "";

    // Entity Data Buffers
    let vertices: number[] = [];
    let isClosed = false;
    let circleCenter = new THREE.Vector3();
    let circleRadius = 0;
    let polyX = 0;

    const flushEntity = () => {
      if (entityType === "LINE" && vertices.length === 6) {
        this.createLine(group, vertices);
      } else if (entityType === "LWPOLYLINE" && vertices.length >= 6) {
        this.createPolyline(group, vertices, isClosed);
      } else if (entityType === "CIRCLE" && circleRadius > 0) {
        this.createCircle(group, circleCenter, circleRadius);
      }
      
      // Reset
      entityType = "";
      vertices = [];
      isClosed = false;
      circleRadius = 0;
    };

    for (let i = 0; i < lines.length; i += 2) {
      if (i + 1 >= lines.length) break;

      code = parseInt(lines[i].trim());
      value = lines[i + 1].trim();

      if (isNaN(code)) continue;

      if (code === 0) {
        if (currentSection === "ENTITIES") flushEntity();

        if (value === "SECTION") {
          // Next code 2 will define section name
        } else if (value === "ENDSEC") {
          currentSection = "";
        } else if (value === "EOF") {
          break;
        } else if (currentSection === "ENTITIES") {
          entityType = value;
          if (entityType === "LINE") vertices = [0, 0, 0, 0, 0, 0];
          else vertices = [];
        }
      } else if (code === 2 && lines[i - 2]?.trim() === "0" && lines[i - 1]?.trim() === "SECTION") {
        currentSection = value;
      } else if (currentSection === "ENTITIES") {
        if (entityType === "LINE") {
          if (code === 10) vertices[0] = parseFloat(value);
          if (code === 20) vertices[1] = parseFloat(value);
          if (code === 30) vertices[2] = parseFloat(value);
          if (code === 11) vertices[3] = parseFloat(value);
          if (code === 21) vertices[4] = parseFloat(value);
          if (code === 31) vertices[5] = parseFloat(value);
        } else if (entityType === "LWPOLYLINE") {
          if (code === 10) polyX = parseFloat(value);
          if (code === 20) vertices.push(polyX, parseFloat(value), 0);
          if (code === 70) isClosed = (parseInt(value) & 1) === 1;
        } else if (entityType === "CIRCLE") {
          if (code === 10) circleCenter.x = parseFloat(value);
          if (code === 20) circleCenter.y = parseFloat(value);
          if (code === 30) circleCenter.z = parseFloat(value);
          if (code === 40) circleRadius = parseFloat(value);
        }
      }
    }
    flushEntity();

    return group;
  }

  private createLine(group: THREE.Group, positions: number[]) {
    this.addGeo(group, positions);
  }

  private createPolyline(group: THREE.Group, positions: number[], closed: boolean) {
    if (closed && positions.length >= 3) {
      positions.push(positions[0], positions[1], positions[2]);
    }
    this.addGeo(group, positions);
  }

  private createCircle(group: THREE.Group, center: THREE.Vector3, radius: number) {
    const segments = 64;
    const positions: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      positions.push(center.x + Math.cos(theta) * radius, center.y + Math.sin(theta) * radius, center.z);
    }
    this.addGeo(group, positions);
  }

  private addGeo(group: THREE.Group, positions: number[]) {
    if (positions.length < 6) return;
    const geometry = new LineGeometry();
    geometry.setPositions(positions);
    const material = new LineMaterial({
      color: this.defaultColor,
      linewidth: this.defaultLineWidth,
      resolution: this.resolution, // Use class property
      dashed: false
    });
    const line = new Line2(geometry, material);
    line.computeLineDistances();
    group.add(line);
  }
}