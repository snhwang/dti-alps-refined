import { useEffect, useRef } from 'react';
import { Engine, Scene, Vector3, ArcRotateCamera, HemisphericLight, MeshBuilder } from '@babylonjs/core';

const SceneComponent = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (!canvasRef.current) return;

        // Initialize Babylon Engine
        const engine = new Engine(canvasRef.current, true);
        const scene = new Scene(engine);

        // Transparent background
        scene.clearColor.set(0, 0, 0, 0);

        // Camera
        const camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2.5, 3, Vector3.Zero(), scene);
        camera.attachControl(canvasRef.current, true);
        camera.wheelPrecision = 50;

        // Light
        const light = new HemisphericLight("light", new Vector3(0, 1, 0), scene);
        light.intensity = 0.7;

        // Placeholder Brain Object (Sphere)
        MeshBuilder.CreateSphere("brain-placeholder", { diameter: 1.5, segments: 32 }, scene);

        // Animation loop
        engine.runRenderLoop(() => {
            scene.render();
        });

        // Resize handling
        const handleResize = () => engine.resize();
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            engine.dispose();
        };
    }, []);

    return (
        <canvas ref={canvasRef} className="w-full h-full outline-none" />
    );
};

export default SceneComponent;
