import HealthController from "./health";

test("it should pass", async () => {
  const healthController = new HealthController();
  const response = await healthController.getHealth();
  expect(response.message).toBe("OK");
});
